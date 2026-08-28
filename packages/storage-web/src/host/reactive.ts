import { createEventChannel } from '@migaia/event-subscriber'
import {
  createAbortController,
  createSyncLifecycleScope,
  createLifecycleScope
} from '@migaia/lifecycle'
import { Resource } from '@migaia/resource'
import type { IComputedValue, IRuntime } from '@migaia/reactive/runtime'
import {
  createStorageAggregateError,
  createStorageTypeError,
  StorageError,
  StorageErrorCode
} from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import {
  getBackendReactiveController,
  type IBackendReactiveController
} from '../backends/reactive-controller.js'
import { reportCleanupError } from '../core/operation-reporter.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IKeyValueStore,
  type IStorageChange
} from '@migaia/storage-contract'
import { raceWithAbort, withTimeout } from '@migaia/utils/promise'
import type {
  ILiveQuery,
  ILiveQueryState,
  ILiveQueryStateView,
  IReactiveConsistency,
  IStorageReactiveFeatureMetadata,
  IStorageReactiveSourceDisposer
} from './types.js'
import { isStorageReactiveVisibility, LiveQueryStateStatus } from './state-constants.js'

/** Private shared-cell key used to pass one exact materialized store to its adapter. */
/** Private shared-cell key used to pass one Host-wide service to every adapter. */
export const storageReactiveServiceCellKey: unique symbol = Symbol('storage-web/reactive-service')

/** Query terminal callback invoked when its owning adapter seals, with a failure collector. */
export type IStorageReactiveQueryTerminal = (
  recordFailure?: (error: unknown) => void
) => void | PromiseLike<void>

/** One idempotent query admission, including its stable terminal promise. */
export type IStorageReactiveQueryLease = {
  readonly release: () => void
  readonly terminate: () => Promise<void>
}

/** Single-assignment shared cell preserving store identity across PluginHost extensions. */
export type IStorageStoreCell = {
  readonly key: symbol
  readonly set: (store: IKeyValueStore) => void
  readonly get: () => IKeyValueStore
}

/** Creates a private cell; adapters cannot substitute a different backend instance. */
export const createStorageStoreCell = (): IStorageStoreCell => {
  const key = Symbol('storage-web/reactive-store-cell')
  let value: IKeyValueStore | undefined
  return {
    key,
    set: (store) => {
      if (value !== undefined)
        throw new StorageError(
          StorageErrorCode.reactiveFeatureInvalid,
          {},
          StorageErrorText.reactiveFeatureInvalid
        )
      value = store
    },
    get: () => {
      if (value === undefined)
        throw new StorageError(
          StorageErrorCode.reactiveFeatureInvalid,
          {},
          StorageErrorText.reactiveFeatureInvalid
        )
      return value
    }
  }
}

/** Internal adapter handle used by the service registry and Host identity lookup. */
export type IStorageReactiveAdapter = {
  readonly backendId: string
  readonly store: IKeyValueStore
  readonly controller: IBackendReactiveController
  readonly consistency: IStorageReactiveFeatureMetadata
  readonly acquireQuery: (
    terminal?: IStorageReactiveQueryTerminal,
    onChange?: (change: IStorageChange) => void
  ) => IStorageReactiveQueryLease
  readonly startSource: () => void
  readonly dispose: () => Promise<void>
}

/** Host-wide service composing lifecycle query admission with Resource request state. */
export type IStorageReactiveService = {
  readonly registerAdapter: (input: {
    readonly backendId: string
    readonly store: IKeyValueStore
    readonly controller: IBackendReactiveController
    readonly consistency: IStorageReactiveFeatureMetadata
    readonly subscribe: IStorageReactiveFeatureMetadata['subscribe']
    readonly report: (error: unknown) => void
  }) => IStorageReactiveAdapter
  readonly createQuery: <T>(input: IStorageReactiveQueryInput<T>) => ILiveQuery<T>
  readonly acquireQuery: (
    backendId: string,
    terminal?: IStorageReactiveQueryTerminal
  ) => IStorageReactiveQueryLease
  readonly dispose: () => Promise<void>
}

/** Exact service query input; request state remains owned by Resource. */
export type IStorageReactiveQueryInput<T> = {
  readonly backendId: string
  readonly runtime: IRuntime
  readonly query: (context: {
    readonly store: IKeyValueStore
    readonly signal: import('@migaia/lifecycle').IAbortSignal
    readonly scope?: string
  }) => T | PromiseLike<T>
  readonly scope?: string
  readonly matches?: (change: IStorageChange) => boolean
  readonly keepPreviousData?: boolean
  readonly equals?: (previous: T, next: T) => boolean
  readonly timeoutMs?: number
  readonly signal?: import('@migaia/lifecycle').IAbortSignal
  readonly report?: (error: unknown) => void | PromiseLike<void>
  readonly scheduler?: import('@migaia/lifecycle').ILifecycleScheduler
}

/** Creates the one service instance owned by one StorageHost. */
export const createStorageReactiveService = (): IStorageReactiveService => {
  const adapters = new Map<string, IStorageReactiveAdapter>()
  const serviceScope = createLifecycleScope({ errorPolicy: 'collect' })
  const serviceRecord = {}

  /** Reports lifecycle failures without changing committed outcomes. */
  const report = (input: (error: unknown) => void, error: unknown): void => {
    reportCleanupError(input, error)
  }

  /** Disposes registered adapters through the service lifecycle owner. */
  const disposeAdapters = async (): Promise<void> => {
    const failures = await Promise.allSettled(
      [...adapters.values()].map((adapter) => adapter.dispose())
    )
    adapters.clear()
    for (const failure of failures) if (failure.status === 'rejected') throw failure.reason
  }
  serviceScope.own(serviceRecord, { order: 0, force: disposeAdapters })

  const registerAdapter = (input: {
    readonly backendId: string
    readonly store: IKeyValueStore
    readonly controller: IBackendReactiveController
    readonly consistency: IStorageReactiveFeatureMetadata
    readonly subscribe: IStorageReactiveFeatureMetadata['subscribe']
    readonly report: (error: unknown) => void
  }): IStorageReactiveAdapter => {
    if (serviceScope.lifecycle !== 'open' || adapters.has(input.backendId))
      throw new StorageError(
        StorageErrorCode.reactiveFeatureInvalid,
        {},
        StorageErrorText.reactiveFeatureInvalid
      )
    if (getBackendReactiveController(input.store) !== input.controller)
      throw new StorageError(
        StorageErrorCode.reactiveFeatureInvalid,
        {},
        StorageErrorText.reactiveFeatureInvalid
      )
    if (
      (input.consistency.mode !== 'push' &&
        (!Number.isFinite(input.consistency.pollIntervalMs) ||
          input.consistency.pollIntervalMs === undefined ||
          input.consistency.pollIntervalMs <= 0)) ||
      (input.consistency.mode === 'push' && input.consistency.pollIntervalMs !== undefined) ||
      !isStorageReactiveVisibility(input.consistency.visibility)
    )
      throw new StorageError(
        StorageErrorCode.reactiveFeatureInvalid,
        {},
        StorageErrorText.reactiveFeatureInvalid
      )

    /** Frozen adapter admission facts exposed to every query as actual consistency. */
    const actualConsistency = Object.freeze({
      mode: input.consistency.mode,
      visibility: input.consistency.visibility,
      ...(input.consistency.pollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: input.consistency.pollIntervalMs })
    }) as IStorageReactiveFeatureMetadata

    const adapterScope = createSyncLifecycleScope({
      errorPolicy: 'collect',
      report: (error) => report(input.report, error)
    })
    const sourceAbort = createAbortController()
    const invalidations = createEventChannel<IStorageChange>({
      dispatchPolicy: 'queued',
      report: (error) => report(input.report, error)
    })
    const sourceRecord = {}
    let sourceStop: IStorageReactiveSourceDisposer | undefined
    let sourceStopCalled = false
    let sourceStopPromise: Promise<void> | undefined
    let adapterDisposePromise: Promise<void> | undefined
    let nextQueryOrder = 0
    let cleanupPromises: Promise<void>[] | undefined

    /** Invokes one captured source disposer and preserves stable completion identity. */
    const invokeSourceStop = (): Promise<void> => {
      if (sourceStopPromise !== undefined) return sourceStopPromise
      if (sourceStop === undefined) return Promise.resolve()
      sourceStopCalled = true
      try {
        sourceStopPromise = Promise.resolve(sourceStop()).then(() => undefined)
      } catch (error) {
        sourceStopPromise = Promise.reject(error)
      }
      void sourceStopPromise.catch(() => undefined)
      return sourceStopPromise
    }

    /** Captures late disposer and releases it immediately after a sealed source admission. */
    const captureSourceStop = (value: unknown): void => {
      if (typeof value !== 'function') {
        report(
          input.report,
          createStorageTypeError(
            StorageErrorCode.reactiveFeatureInvalid,
            StorageErrorText.reactiveFeatureInvalid
          )
        )
        return
      }
      sourceStop = value as IStorageReactiveSourceDisposer
      if (sourceStopCalled || adapterScope.lifecycle !== 'open')
        void invokeSourceStop().catch((error) => report(input.report, error))
    }

    /** Publishes one backend invalidation; event-subscriber owns fanout snapshot/order. */
    const publishChange = (change: IStorageChange): void => {
      try {
        invalidations.publish(change)
      } catch (error) {
        report(input.report, error)
      }
    }

    /** Performs one synchronous source subscription admission required by D79. */
    const startSource = (): void => {
      if (adapterScope.lifecycle !== 'open') return
      let result: unknown
      try {
        result = (input.subscribe ?? ((context) => input.controller.subscribe(context.onChange)))({
          store: input.store,
          signal: sourceAbort.signal,
          report: (error) => report(input.report, error),
          onChange: publishChange
        })
      } catch (error) {
        try {
          sourceAbort.abort(error)
        } catch (abortError) {
          report(input.report, abortError)
        }
        adapterScope.close()
        throw createStorageTypeError(
          StorageErrorCode.reactiveFeatureInvalid,
          StorageErrorText.reactiveFeatureInvalid,
          error
        )
      }
      if (typeof result === 'function') {
        captureSourceStop(result)
        return
      }
      const violation = createStorageTypeError(
        StorageErrorCode.reactiveFeatureInvalid,
        StorageErrorText.reactiveFeatureInvalid
      )
      try {
        sourceAbort.abort(violation)
      } catch (error) {
        report(input.report, error)
      }
      adapterScope.close()
      if (result !== null && (typeof result === 'object' || typeof result === 'function'))
        void Promise.resolve(result).then(captureSourceStop, (error) => report(input.report, error))
      throw violation
    }

    /** Registers one query as a lifecycle-owned resource, never in a terminal registry. */
    const acquireQuery = (
      terminal?: IStorageReactiveQueryTerminal,
      onChange?: (change: IStorageChange) => void
    ): IStorageReactiveQueryLease => {
      if (adapterScope.lifecycle !== 'open')
        throw new StorageError(
          StorageErrorCode.reactiveAdapterNotInstalled,
          {},
          StorageErrorText.reactiveAdapterNotInstalled
        )
      const queryRecord = {}
      const queryOrder = 1_000_000 - nextQueryOrder++
      let released = false
      let subscriptionReleased = false
      let terminalPromise: Promise<void> | undefined
      const subscription =
        onChange === undefined
          ? undefined
          : invalidations.subscribe((event) => {
              try {
                onChange(event.value)
              } catch (error) {
                report(input.report, error)
              }
            })
      /** Releases query admission and records every cleanup failure before one stable settlement. */
      const releaseQuery = (recordFailure: (error: unknown) => void): void => {
        if (released) return
        released = true
        if (!subscriptionReleased) {
          subscriptionReleased = true
          try {
            subscription?.()
          } catch (error) {
            recordFailure(error)
          }
        }
        try {
          adapterScope.release(queryRecord)
        } catch (error) {
          recordFailure(error)
        }
      }

      const terminate = (): Promise<void> => {
        if (terminalPromise !== undefined) return terminalPromise
        const failures: unknown[] = []
        const recordFailure = (error: unknown): void => {
          failures.push(error)
        }
        let terminalResult: void | PromiseLike<void> = undefined
        try {
          terminalResult = terminal?.(recordFailure)
        } catch (error) {
          recordFailure(error)
        }
        const finalize = (): void => {
          releaseQuery(recordFailure)
          if (failures.length > 0)
            throw createStorageAggregateError(
              StorageErrorCode.liveQueryDisposeFailed,
              StorageErrorText.liveQueryDisposeFailed,
              failures
            )
        }
        terminalPromise = Promise.resolve(terminalResult).then(
          () => finalize(),
          (error) => {
            recordFailure(error)
            return finalize()
          }
        )
        void terminalPromise.catch(() => undefined)
        return terminalPromise
      }
      const lease: IStorageReactiveQueryLease = {
        release: () => {
          const failures: unknown[] = []
          releaseQuery((error) => failures.push(error))
          if (failures.length > 0) throw failures[0]
        },
        terminate
      }
      adapterScope.own(queryRecord, {
        syncSafe: true,
        order: queryOrder,
        force: () => {
          cleanupPromises?.push(terminate())
        }
      })
      return lease
    }

    /** Source gets the highest release order, enforcing D81 source-before-query same-tick order. */
    adapterScope.own(sourceRecord, {
      syncSafe: true,
      order: Number.MAX_SAFE_INTEGER,
      force: () => {
        try {
          sourceAbort.abort()
        } catch (error) {
          report(input.report, error)
        }
        const stop = invokeSourceStop()
        cleanupPromises?.push(stop)
      }
    })

    const adapter: IStorageReactiveAdapter = {
      backendId: input.backendId,
      store: input.store,
      controller: input.controller,
      consistency: actualConsistency,
      acquireQuery,
      startSource,
      dispose: () => {
        if (adapterDisposePromise !== undefined) return adapterDisposePromise
        cleanupPromises = []
        adapterScope.close()
        const scopeFailures = adapterScope.dispose()
        const pending = cleanupPromises
        cleanupPromises = undefined
        adapterDisposePromise = Promise.allSettled(pending).then((results) => {
          adapters.delete(input.backendId)
          for (const failure of scopeFailures) report(input.report, failure.error)
          for (const result of results)
            if (result.status === 'rejected') report(input.report, result.reason)
        })
        return adapterDisposePromise
      }
    }
    adapters.set(input.backendId, adapter)
    return adapter
  }

  return {
    registerAdapter,
    createQuery: <T>(input: IStorageReactiveQueryInput<T>) => {
      if (serviceScope.lifecycle !== 'open')
        throw new StorageError(
          StorageErrorCode.reactiveAdapterNotInstalled,
          {},
          StorageErrorText.reactiveAdapterNotInstalled
        )
      const adapter = adapters.get(input.backendId)
      if (adapter === undefined)
        throw new StorageError(
          StorageErrorCode.reactiveAdapterNotInstalled,
          {},
          StorageErrorText.reactiveAdapterNotInstalled
        )
      const reportQuery = (error: unknown): void => {
        try {
          const result = input.report?.(error)
          if (result !== undefined) void Promise.resolve(result).catch(() => undefined)
        } catch {
          // Query diagnostics are report-only and must not replace the query outcome.
        }
      }
      let externallyAborted = false
      let externalAbortReason: unknown
      if (input.signal !== undefined) {
        try {
          externallyAborted = input.signal.aborted
          if (externallyAborted) externalAbortReason = input.signal.reason
        } catch (cause) {
          throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
        }
      }
      if (externallyAborted)
        throw new StorageContractError(StorageContractErrorCode.aborted, {
          cause: externalAbortReason
        })
      if (
        (input.scope !== undefined && typeof input.scope !== 'string') ||
        (input.matches !== undefined && typeof input.matches !== 'function') ||
        (input.equals !== undefined && typeof input.equals !== 'function') ||
        (input.report !== undefined && typeof input.report !== 'function') ||
        (input.timeoutMs !== undefined &&
          (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 0))
      )
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)

      let resource: Resource<T> | undefined
      /** Canonical same-runtime computed projection whose dependency is Resource.state. */
      let computedState: IComputedValue<ILiveQueryState<T>> | undefined
      /** Cached terminal projection retained after lifecycle disposes the computed owner. */
      let disposedState: ILiveQueryState<T> | undefined
      let computedStateDisposed = false
      let removeExternalAbort = (_recordFailure?: (error: unknown) => void): void => undefined
      let disposeQuery: () => Promise<void> = () => Promise.resolve()
      let externalAbortObserved = false
      let externalAbortRegistrationAttempted = false
      let externalAbortRegistrationReturned = false
      let externalAbortCleanupAttempted = false
      let disposePromise: Promise<void> | undefined
      let terminalError: unknown
      let rejectTerminal!: (reason?: unknown) => void
      /** Stable lifecycle rejection gate shared by pending and post-terminal outward projections. */
      const terminalPromise = new Promise<never>((_resolve, reject) => {
        rejectTerminal = reject
      })
      void terminalPromise.catch(() => undefined)
      /** Applies the caller equality policy while leaving request state owned by Resource. */
      let visibleValue: T | undefined
      let hasVisibleValue = false
      const commitVisibleValue = (next: T): T => {
        if (hasVisibleValue && input.equals !== undefined) {
          try {
            if (input.equals(visibleValue as T, next)) return visibleValue as T
          } catch (error) {
            reportQuery(error)
          }
        }
        visibleValue = next
        hasVisibleValue = true
        return next
      }
      /** Captures the lifecycle-owned terminal identity before Resource cleanup or access. */
      const markTerminal = (): unknown => {
        if (terminalError !== undefined) return terminalError
        const current = computedState?.peek()
        terminalError = externalAbortObserved
          ? new StorageContractError(StorageContractErrorCode.aborted, {
              cause: externalAbortReason
            })
          : new StorageError(
              StorageErrorCode.liveQueryDisposed,
              {},
              StorageErrorText.liveQueryDisposed
            )
        const value = current !== undefined && 'value' in current ? { value: current.value } : {}
        disposedState = {
          status: LiveQueryStateStatus.disposed,
          ...value,
          error: terminalError
        } as ILiveQueryState<T>
        rejectTerminal(terminalError)
        return terminalError
      }

      /** Returns one handled stable rejection for every post-terminal outward operation. */
      const terminalRejection = (): Promise<never> => {
        markTerminal()
        return terminalPromise
      }

      const lease = adapter.acquireQuery(
        (recordFailure) => {
          markTerminal()
          try {
            resource?.dispose()
          } catch (error) {
            if (recordFailure === undefined) throw error
            recordFailure(error)
          }
          try {
            if (disposedState === undefined) markTerminal()
          } catch (error) {
            if (recordFailure === undefined) throw error
            recordFailure(error)
          }
          if (!computedStateDisposed) {
            computedStateDisposed = true
            try {
              computedState?.dispose()
            } catch (error) {
              if (recordFailure === undefined) throw error
              recordFailure(error)
            }
          }
          removeExternalAbort(recordFailure)
        },
        (change) => {
          if (
            input.scope !== undefined &&
            change.scope !== undefined &&
            change.scope !== input.scope
          )
            return
          let related = true
          if (input.matches !== undefined) {
            try {
              related = input.matches(change)
            } catch (error) {
              reportQuery(error)
              related = true
            }
          }
          if (!related) return
          if (terminalError !== undefined) return
          if (resource === undefined) return
          try {
            const invalidation = resource.invalidate()
            void invalidation.catch(() => undefined)
          } catch {
            // Resource rejects late invalidation after terminal; terminal ownership already won.
          }
        }
      )

      /** Rolls back construction in reverse acquisition order and preserves every original failure. */
      const rollbackConstruction = (primary: unknown, cleanups: readonly (() => void)[]): never => {
        const failures: unknown[] = [primary]
        for (let index = cleanups.length - 1; index >= 0; index -= 1) {
          try {
            cleanups[index]!()
          } catch (error) {
            failures.push(error)
          }
        }
        if (failures.length === 1) throw primary
        throw createStorageAggregateError(
          StorageErrorCode.liveQueryDisposeFailed,
          StorageErrorText.liveQueryDisposeFailed,
          failures
        )
      }

      /** Terminates the lifecycle lease and Resource exactly once, even during construction races. */
      disposeQuery = () => {
        if (disposePromise !== undefined) return disposePromise
        markTerminal()
        disposePromise = lease.terminate()
        void disposePromise.catch(() => undefined)
        return disposePromise
      }

      /** Observes the caller signal before any Resource or computed allocation. */
      const onExternalAbort = (): void => {
        externalAbortObserved = true
        try {
          externalAbortReason = input.signal?.reason
        } catch (error) {
          reportQuery(error)
        }
        if (resource !== undefined || computedState !== undefined) {
          try {
            void disposeQuery().catch((error) => reportQuery(error))
          } catch (error) {
            reportQuery(error)
          }
        }
      }

      /** Removes the pre-allocation caller-signal listener exactly once. */
      removeExternalAbort = (recordFailure): void => {
        if (
          input.signal === undefined ||
          !externalAbortRegistrationAttempted ||
          !externalAbortRegistrationReturned ||
          externalAbortCleanupAttempted
        )
          return
        externalAbortCleanupAttempted = true
        try {
          input.signal.removeEventListener('abort', onExternalAbort)
        } catch (error) {
          if (recordFailure === undefined) reportQuery(error)
          else recordFailure(error)
        }
      }

      /** Removes the caller-signal listener for construction rollback, preserving its failure. */
      const cleanupExternalAbort = (): void => {
        let cleanupFailure: unknown
        let cleanupFailed = false
        removeExternalAbort((error) => {
          cleanupFailure = error
          cleanupFailed = true
        })
        if (cleanupFailed) throw cleanupFailure
      }

      /** Registers caller cancellation before any Resource exists, preserving zero-allocation abort. */
      const registerExternalAbort = (): void => {
        if (input.signal === undefined) return
        externalAbortRegistrationAttempted = true
        try {
          input.signal.addEventListener('abort', onExternalAbort, { once: true })
          externalAbortRegistrationReturned = true
        } catch (cause) {
          externalAbortRegistrationReturned = true
          throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
        }
        if (externalAbortObserved || input.signal.aborted) {
          externalAbortObserved = true
          try {
            externalAbortReason = input.signal.reason
          } catch (error) {
            reportQuery(error)
          }
          throw new StorageContractError(StorageContractErrorCode.aborted, {
            cause: externalAbortReason
          })
        }
      }

      /** Creates the Resource after lifecycle and external-abort admission have both succeeded. */
      try {
        registerExternalAbort()
      } catch (error) {
        rollbackConstruction(error, [lease.release, cleanupExternalAbort])
      }
      try {
        resource = new Resource<T>(
          ({ signal }) => {
            const operation = ({
              signal: operationSignal
            }: {
              readonly signal: import('@migaia/lifecycle').IAbortSignal
            }) => input.query({ store: adapter.store, signal: operationSignal, scope: input.scope })
            const request =
              input.timeoutMs === undefined
                ? raceWithAbort(operation, {
                    signal,
                    report: (error) => reportQuery(error)
                  })
                : withTimeout(operation, {
                    timeoutMs: input.timeoutMs,
                    signal,
                    scheduler: input.scheduler,
                    report: (error) => reportQuery(error)
                  })
            return request
              .then((next) => commitVisibleValue(next))
              .catch((cause) => {
                if (cause instanceof StorageContractError) throw cause
                throw new StorageError(
                  StorageErrorCode.extensionFailed,
                  { cause, operation: 'liveQuery' },
                  StorageErrorText.liveQueryFailed
                )
              })
          },
          input.runtime,
          {
            autoStart: false,
            ttl: Infinity,
            retry: 0,
            staleWhileRevalidate: input.keepPreviousData ?? true,
            keepAlive: true,
            scheduler: input.scheduler
          }
        )
      } catch (error) {
        rollbackConstruction(error, [lease.release, cleanupExternalAbort])
      }
      /** Projects the canonical Resource state into the public live-query state union. */
      const projectResourceState = (): ILiveQueryState<T> => {
        if (terminalError !== undefined)
          return (
            disposedState ?? {
              status: LiveQueryStateStatus.disposed,
              error: terminalError
            }
          )
        const state = resource!.state
        if (state.status === 'success')
          return state.refreshing === true
            ? { status: LiveQueryStateStatus.refreshing, value: state.data }
            : { status: LiveQueryStateStatus.ready, value: state.data }
        if (state.status === 'error' || state.status === 'cancelled') {
          const value =
            hasVisibleValue && input.keepPreviousData !== false ? { value: visibleValue } : {}
          return {
            status: LiveQueryStateStatus.error,
            ...value,
            error: state.error
          } as ILiveQueryState<T>
        }
        return hasVisibleValue && input.keepPreviousData !== false
          ? { status: LiveQueryStateStatus.refreshing, value: visibleValue as T }
          : { status: LiveQueryStateStatus.loading }
      }
      /** Same-runtime computed owner derives directly from Resource's reactive state signal. */
      try {
        computedState = input.runtime.computed(projectResourceState, {
          keepAlive: true,
          debugName: 'storage-web/live-query-state'
        })
      } catch (error) {
        rollbackConstruction(error, [
          lease.release,
          cleanupExternalAbort,
          () => resource!.dispose()
        ])
      }
      const queryResource = resource!
      /** Immutable actual adapter consistency captured at query admission. */
      const consistency = Object.freeze({
        mode: adapter.consistency.mode,
        visibility: adapter.consistency.visibility,
        ...(adapter.consistency.pollIntervalMs === undefined
          ? {}
          : { pollIntervalMs: adapter.consistency.pollIntervalMs })
      }) as IReactiveConsistency

      /** Public state view delegates to the computed owner without exposing disposal authority. */
      const publicState = Object.freeze({
        get runtime() {
          return input.runtime
        },
        get debugName() {
          return computedState?.debugName
        },
        get observed() {
          return computedStateDisposed ? false : computedState?.observed === true
        },
        get value() {
          if (computedStateDisposed)
            return (
              disposedState ?? {
                status: LiveQueryStateStatus.disposed,
                error: terminalError
              }
            )
          return computedState!.value
        },
        peek() {
          if (computedStateDisposed)
            return (
              disposedState ?? {
                status: LiveQueryStateStatus.disposed,
                error: terminalError
              }
            )
          return computedState!.peek()
        }
      }) as ILiveQueryStateView<T>

      /** Starts one Resource generation or joins its canonical current promise while fetching. */
      const request = (): Promise<T> => {
        try {
          if (terminalError !== undefined) return terminalRejection()
          const current =
            queryResource.fetchStatus === 'fetching'
              ? queryResource.promise
              : queryResource.refetch()
          return current
        } catch (error) {
          return Promise.reject(error)
        }
      }

      /** Projects the exact current Resource promise without owning generation or request state. */
      const projectCurrentPromise = (): Promise<void> => {
        if (terminalError !== undefined) return terminalRejection()
        let source: Promise<T>
        try {
          source = queryResource.promise
        } catch (error) {
          return Promise.reject(error)
        }
        if (projectedPromiseSource === source && projectedPromise !== undefined)
          return projectedPromise
        projectedPromiseSource = source
        const sourceProjection = source.then(
          () => {
            if (terminalError !== undefined) throw terminalError
            if (queryResource.fetchStatus === 'fetching') return projectCurrentPromise()
          },
          (error) => {
            if (terminalError !== undefined) throw terminalError
            if (queryResource.fetchStatus === 'fetching') return projectCurrentPromise()
            throw error
          }
        )
        projectedPromise = Promise.race([sourceProjection, terminalPromise])
        void projectedPromise.catch(() => undefined)
        return projectedPromise
      }

      let projectedPromiseSource: Promise<T> | undefined
      let projectedPromise: Promise<void> | undefined
      const initialRequest = request()
      void initialRequest.catch(() => undefined)
      if (externalAbortObserved) {
        void disposeQuery().catch((error) => reportQuery(error))
        throw new StorageContractError(StorageContractErrorCode.aborted, {
          cause: externalAbortReason
        })
      }
      const ready = projectCurrentPromise()
      void ready.catch(() => undefined)
      return {
        state: publicState,
        consistency,
        ready,
        refresh: () => {
          const current = request()
          void current.catch(() => undefined)
          return projectCurrentPromise()
        },
        dispose: disposeQuery
      }
    },
    acquireQuery: (backendId, terminal) => {
      if (serviceScope.lifecycle !== 'open')
        throw new StorageError(
          StorageErrorCode.reactiveAdapterNotInstalled,
          {},
          StorageErrorText.reactiveAdapterNotInstalled
        )
      const adapter = adapters.get(backendId)
      if (adapter === undefined)
        throw new StorageError(
          StorageErrorCode.reactiveAdapterNotInstalled,
          {},
          StorageErrorText.reactiveAdapterNotInstalled
        )
      return adapter.acquireQuery(terminal)
    },
    dispose: (() => {
      let serviceDisposePromise: Promise<void> | undefined
      return () => {
        if (serviceDisposePromise !== undefined) return serviceDisposePromise
        serviceDisposePromise = serviceScope.dispose().then((failures) => {
          for (const failure of failures) reportCleanupError(() => undefined, failure.error)
        })
        return serviceDisposePromise
      }
    })()
  }
}

/** Performs adapter lookup and registers one exact backend/controller pair. */
export const registerReactiveAdapter = (
  service: IStorageReactiveService,
  backendId: string,
  store: IKeyValueStore,
  report: (error: unknown) => void,
  consistency: IStorageReactiveFeatureMetadata,
  subscribe: IStorageReactiveFeatureMetadata['subscribe']
): IStorageReactiveAdapter => {
  const controller = getBackendReactiveController(store)
  if (controller === undefined)
    throw new StorageError(
      StorageErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )
  return service.registerAdapter({ backendId, store, controller, consistency, subscribe, report })
}
