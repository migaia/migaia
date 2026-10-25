import { createEventChannel } from '@migaia/event-subscriber'
import {
  createAbortController,
  createSyncLifecycleScope,
  createLifecycleScope
} from '@migaia/lifecycle'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { Resource } from '@migaia/resource'
import type { IReactiveComputed, IRuntime } from '@migaia/reactive'
import {
  createStorageAggregateError,
  createStorageTypeError,
  StorageError,
  StorageErrorCode
} from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import type { IBackendChangeController } from '@migaia/storage-host/authoring/backend'
import { reportCleanupError } from '@migaia/storage-host/authoring/backend'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageBase,
  type IStorageResource,
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

/** Query terminal callback invoked when its owning adapter seals, with a failure collector. */
export type IStorageReactiveQueryTerminal = (
  recordFailure?: (error: unknown) => void
) => void | PromiseLike<void>

/** One idempotent query admission, including its stable terminal promise. */
export type IStorageReactiveQueryLease = {
  readonly release: () => void
  readonly terminate: () => Promise<void>
}

/** Internal adapter handle used by the service registry and Host identity lookup. */
export type IStorageReactiveAdapter = {
  readonly backendId: string
  readonly store: IStorageBase
  readonly controller?: IBackendChangeController
  readonly consistency: IStorageReactiveFeatureMetadata
  readonly acquireQuery: (
    terminal?: IStorageReactiveQueryTerminal,
    onChange?: (change?: IStorageChange) => void
  ) => IStorageReactiveQueryLease
  readonly startSource: () => void
  readonly dispose: () => Promise<void>
}

/** One installed Feature service composes the original adapter lifecycle and Resource request state. */
export type IStorageReactiveService = {
  readonly registerAdapter: (input: {
    readonly backendId: string
    readonly store: IStorageBase
    readonly controller?: IBackendChangeController
    readonly consistency: IStorageReactiveFeatureMetadata
    readonly subscribe: IStorageReactiveFeatureMetadata['subscribe']
    readonly report: (error: unknown) => void
  }) => IStorageReactiveAdapter
  readonly createQuery: <T>(
    input: IStorageReactiveQueryInput<T>
  ) => ILiveQuery<T> & IStorageResource
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
    readonly store: IStorageBase
    readonly signal: import('@migaia/utils/promise').INativeAbortSignal
    readonly scope?: string
  }) => T | PromiseLike<T>
  readonly scope?: string
  readonly matches?: (change: IStorageChange) => boolean
  readonly keepPreviousData?: boolean
  readonly equals?: (previous: T, next: T) => boolean
  readonly timeoutMs?: number
  readonly signal?: import('@migaia/utils/promise').IAbortSignal
  readonly report?: (error: unknown) => void | PromiseLike<void>
  readonly scheduler?: IScheduler
}

/** Creates the original service instance owned by one installed reactive Feature. */

/** One reactive Feature service owns its adapter registry and asynchronous lifecycle. */
type IReactiveServiceContext = {
  /** Original scheduler is captured before native construction begins. */
  readonly scheduler: IScheduler

  /** Stable explicit service-disposal promise shared by callers. */
  serviceDisposePromise: Promise<void> | undefined

  /** One backend identity selects one original native adapter for this Feature service. */
  adapters: Map<string, IStorageReactiveAdapter>

  /** Original asynchronous lifecycle owns all adapter cleanup without a parallel registry. */
  serviceScope: ReturnType<typeof createLifecycleScope>

  /** Stable resource identity through which service disposal releases adapters. */
  serviceRecord: object
}
/** Construct one Feature-local adapter registry under the original asynchronous lifecycle. */
export function createStorageReactiveService(
  scheduler: IScheduler = systemScheduler
): IStorageReactiveService {
  /** Initialize native facts in original construction order before publishing any port. */
  const serviceState = { scheduler } as IReactiveServiceContext

  serviceState.adapters = new Map<string, IStorageReactiveAdapter>()

  serviceState.serviceScope = createLifecycleScope({ errorPolicy: 'collect' })

  serviceState.serviceRecord = {}

  serviceState.serviceScope.own(serviceState.serviceRecord, {
    order: 0,
    force: () => disposeAdapters(serviceState)
  })
  return {
    registerAdapter: (input: {
      readonly backendId: string
      readonly store: IStorageBase
      readonly controller?: IBackendChangeController
      readonly consistency: IStorageReactiveFeatureMetadata
      readonly subscribe: IStorageReactiveFeatureMetadata['subscribe']
      readonly report: (error: unknown) => void
    }) => registerAdapter(serviceState, input),
    createQuery: <T>(input: IStorageReactiveQueryInput<T>) =>
      createReactiveQuery(serviceState.adapters, serviceState.serviceScope, input),
    acquireQuery: (backendId, terminal) => {
      if (serviceState.serviceScope.lifecycle !== 'open')
        throw new StorageError(
          StorageErrorCode.reactiveAdapterNotInstalled,
          {},
          StorageErrorText.reactiveAdapterNotInstalled
        )
      const adapter = serviceState.adapters.get(backendId)
      if (adapter === undefined)
        throw new StorageError(
          StorageErrorCode.reactiveAdapterNotInstalled,
          {},
          StorageErrorText.reactiveAdapterNotInstalled
        )
      return adapter.acquireQuery(terminal)
    },
    dispose: () => disposeReactiveService(serviceState)
  }
}

/** Disposes registered adapters through the service lifecycle owner. */
async function disposeAdapters(serviceState: IReactiveServiceContext): Promise<void> {
  const failures = await Promise.allSettled(
    [...serviceState.adapters.values()].map((adapter) => adapter.dispose())
  )
  serviceState.adapters.clear()
  for (const failure of failures) if (failure.status === 'rejected') throw failure.reason
}

/** One admitted adapter owns its native invalidation source and query-admission lifecycle. */
type IReactiveAdapterContext = {
  /** Original serviceState is captured before native construction begins. */
  readonly serviceState: IReactiveServiceContext
  /** Original input is captured before native construction begins. */
  readonly input: {
    readonly backendId: string
    readonly store: IStorageBase
    readonly controller?: IBackendChangeController
    readonly consistency: IStorageReactiveFeatureMetadata
    readonly subscribe: IStorageReactiveFeatureMetadata['subscribe']
    readonly report: (error: unknown) => void
  }

  /**
   * Admitted adapter facts retained across awaited query generations exposed to every query as
   * actual consistency.
   */
  actualConsistency: IStorageReactiveFeatureMetadata

  /** Original synchronous owner preserves source-before-query teardown in the same turn. */
  adapterScope: ReturnType<typeof createSyncLifecycleScope>

  /** Source cancellation is selected before the original source disposer is invoked. */
  sourceAbort: ReturnType<typeof createAbortController>

  /** Canonical event channel owns invalidation fanout and subscription ordering. */
  invalidations: ReturnType<typeof createEventChannel<IStorageChange | undefined>>

  /** Stable source resource has the highest teardown priority within the adapter. */
  sourceRecord: object

  /** Native source disposer retained even when acquisition finishes after sealing. */
  sourceStop: IStorageReactiveSourceDisposer | undefined

  /** Tracks whether native source teardown has already been selected. */
  sourceStopCalled: boolean

  /** Stable native source cleanup settlement shared by terminal callers. */
  sourceStopPromise: Promise<void> | undefined

  /** Stable adapter cleanup joins every accepted query and source result. */
  adapterDisposePromise: Promise<void> | undefined

  /** Monotonic admission order preserves reverse query release under the existing owner. */
  nextQueryOrder: number

  /** Only the active synchronous teardown round collects asynchronous cleanup results. */
  cleanupPromises: Promise<void>[] | undefined

  /** Published adapter handle retains the same native source and consistency facts. */
  adapter: IStorageReactiveAdapter
}
/** Validate native consistency and register one source with the existing service lifecycle. */
function registerAdapter(
  serviceState: IReactiveServiceContext,
  input: {
    readonly backendId: string
    readonly store: IStorageBase
    readonly controller?: IBackendChangeController
    readonly consistency: IStorageReactiveFeatureMetadata
    readonly subscribe: IStorageReactiveFeatureMetadata['subscribe']
    readonly report: (error: unknown) => void
  }
): IStorageReactiveAdapter {
  /** Initialize native facts in original construction order before publishing any port. */
  const adapterState = { serviceState, input } as IReactiveAdapterContext

  if (
    adapterState.serviceState.serviceScope.lifecycle !== 'open' ||
    adapterState.serviceState.adapters.has(adapterState.input.backendId)
  )
    throw new StorageError(
      StorageErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )

  if (
    adapterState.input.controller === undefined &&
    adapterState.input.subscribe === undefined &&
    adapterState.input.consistency.mode !== 'polling'
  )
    throw new StorageError(
      StorageErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )

  if (
    (adapterState.input.consistency.mode !== 'push' &&
      (!Number.isFinite(adapterState.input.consistency.pollIntervalMs) ||
        adapterState.input.consistency.pollIntervalMs === undefined ||
        adapterState.input.consistency.pollIntervalMs <= 0)) ||
    (adapterState.input.consistency.mode === 'push' &&
      adapterState.input.consistency.pollIntervalMs !== undefined) ||
    !isStorageReactiveVisibility(adapterState.input.consistency.visibility)
  )
    throw new StorageError(
      StorageErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )

  /**
   * Admitted adapter facts retained across awaited query generations exposed to every query as
   * actual consistency.
   */
  adapterState.actualConsistency = {
    mode: adapterState.input.consistency.mode,
    visibility: adapterState.input.consistency.visibility,
    ...(adapterState.input.consistency.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: adapterState.input.consistency.pollIntervalMs })
  } as IStorageReactiveFeatureMetadata

  adapterState.adapterScope = createSyncLifecycleScope({
    errorPolicy: 'collect',
    report: (error) => reportCleanupError(adapterState.input.report, error)
  })

  adapterState.sourceAbort = createAbortController()

  adapterState.invalidations = createEventChannel<IStorageChange | undefined>({
    dispatchPolicy: 'queued',
    report: (error) => reportCleanupError(adapterState.input.report, error)
  })

  adapterState.sourceRecord = {}

  adapterState.sourceStopCalled = false

  adapterState.nextQueryOrder = 0

  /** Source gets the highest release order, enforcing source-before-query same-tick order. */
  adapterState.adapterScope.own(adapterState.sourceRecord, {
    syncSafe: true,
    order: Number.MAX_SAFE_INTEGER,
    force: () => {
      try {
        adapterState.sourceAbort.abort()
      } catch (error) {
        reportCleanupError(adapterState.input.report, error)
      }
      const stop = invokeSourceStop(adapterState)
      adapterState.cleanupPromises?.push(stop)
    }
  })

  adapterState.adapter = {
    backendId: adapterState.input.backendId,
    store: adapterState.input.store,
    controller: adapterState.input.controller,
    consistency: adapterState.actualConsistency,
    acquireQuery: (
      terminal?: IStorageReactiveQueryTerminal,
      onChange?: (change?: IStorageChange) => void
    ) => acquireQuery(adapterState, terminal, onChange),
    startSource: () => startSource(adapterState),
    dispose: () => {
      if (adapterState.adapterDisposePromise !== undefined)
        return adapterState.adapterDisposePromise
      adapterState.cleanupPromises = []
      adapterState.adapterScope.close()
      const scopeFailures = adapterState.adapterScope.dispose()
      const pending = adapterState.cleanupPromises
      adapterState.cleanupPromises = undefined
      adapterState.adapterDisposePromise = Promise.allSettled(pending).then((results) => {
        adapterState.serviceState.adapters.delete(adapterState.input.backendId)
        for (const failure of scopeFailures)
          reportCleanupError(adapterState.input.report, failure.error)
        for (const result of results)
          if (result.status === 'rejected')
            reportCleanupError(adapterState.input.report, result.reason)
      })
      return adapterState.adapterDisposePromise
    }
  }

  adapterState.serviceState.adapters.set(adapterState.input.backendId, adapterState.adapter)
  return adapterState.adapter
}

/** Invokes one captured source disposer and preserves stable completion identity. */
function invokeSourceStop(adapterState: IReactiveAdapterContext): Promise<void> {
  if (adapterState.sourceStopPromise !== undefined) return adapterState.sourceStopPromise
  if (adapterState.sourceStop === undefined) return Promise.resolve()
  adapterState.sourceStopCalled = true
  try {
    adapterState.sourceStopPromise = Promise.resolve(adapterState.sourceStop()).then(
      () => undefined
    )
  } catch (error) {
    adapterState.sourceStopPromise = Promise.reject(error)
  }
  void adapterState.sourceStopPromise.catch(() => undefined)
  return adapterState.sourceStopPromise
}

/** Captures late disposer and releases it immediately after a sealed source admission. */
function captureSourceStop(adapterState: IReactiveAdapterContext, value: unknown): void {
  if (typeof value !== 'function') {
    reportCleanupError(
      adapterState.input.report,
      createStorageTypeError(
        StorageErrorCode.reactiveFeatureInvalid,
        StorageErrorText.reactiveFeatureInvalid
      )
    )
    return
  }
  adapterState.sourceStop = value as IStorageReactiveSourceDisposer
  if (adapterState.sourceStopCalled || adapterState.adapterScope.lifecycle !== 'open')
    void invokeSourceStop(adapterState).catch((error) =>
      reportCleanupError(adapterState.input.report, error)
    )
}

/** Publishes one backend invalidation; event-subscriber owns fanout snapshot/order. */
function publishChange(adapterState: IReactiveAdapterContext, change?: IStorageChange): void {
  try {
    adapterState.invalidations.publish(change)
  } catch (error) {
    reportCleanupError(adapterState.input.report, error)
  }
}

/** Performs one synchronous source subscription admission. */
function startSource(adapterState: IReactiveAdapterContext): void {
  if (adapterState.adapterScope.lifecycle !== 'open') return
  let result: unknown
  try {
    result = (
      adapterState.input.subscribe ??
      ((context) => adapterState.input.controller?.subscribe(context.onChange) ?? (() => undefined))
    )({
      store: adapterState.input.store,
      scheduler: adapterState.serviceState.scheduler,
      signal: adapterState.sourceAbort.signal,
      report: (error) => reportCleanupError(adapterState.input.report, error),
      onChange: (change?: IStorageChange) => publishChange(adapterState, change)
    })
  } catch (error) {
    try {
      adapterState.sourceAbort.abort(error)
    } catch (abortError) {
      reportCleanupError(adapterState.input.report, abortError)
    }
    adapterState.adapterScope.close()
    throw createStorageTypeError(
      StorageErrorCode.reactiveFeatureInvalid,
      StorageErrorText.reactiveFeatureInvalid,
      error
    )
  }
  if (typeof result === 'function') {
    captureSourceStop(adapterState, result)
    return
  }
  const violation = createStorageTypeError(
    StorageErrorCode.reactiveFeatureInvalid,
    StorageErrorText.reactiveFeatureInvalid
  )
  try {
    adapterState.sourceAbort.abort(violation)
  } catch (error) {
    reportCleanupError(adapterState.input.report, error)
  }
  adapterState.adapterScope.close()
  if (result !== null && (typeof result === 'object' || typeof result === 'function'))
    void Promise.resolve(result).then(
      (value: unknown) => captureSourceStop(adapterState, value),
      (error) => reportCleanupError(adapterState.input.report, error)
    )
  throw violation
}

/** Registers one query as a lifecycle-owned resource, never in a terminal registry. */

/** One query lease owns its subscription, release state and stable terminal result. */
type IReactiveLeaseContext = {
  /** Original adapterState is captured before native construction begins. */
  readonly adapterState: IReactiveAdapterContext
  /** Original terminal is captured before native construction begins. */
  readonly terminal: IStorageReactiveQueryTerminal
  /** Original onChange is captured before native construction begins. */
  readonly onChange: (change?: IStorageChange) => void

  /** Stable lifecycle identity releases this one admitted query. */
  queryRecord: object

  /** Original order value preserves source-first and reverse-query cleanup. */
  queryOrder: number

  /** Admission release happens once even if explicit disposal races adapter shutdown. */
  released: boolean

  /** Invalidation subscription is released once before query ownership ends. */
  subscriptionReleased: boolean

  /** Stable terminal result is shared by every explicit or owner-triggered close. */
  terminalPromise: Promise<void> | undefined

  /** Original event-channel subscription disposer retained until query release. */
  subscription: ReturnType<IReactiveAdapterContext['invalidations']['subscribe']> | undefined

  /** Original adapter lease owns cleanup of this query projection and native invalidations. */
  lease: IStorageReactiveQueryLease
}
/** Register one query lease without creating request or generation ownership. */
function acquireQuery(
  adapterState: IReactiveAdapterContext,
  terminal?: IStorageReactiveQueryTerminal,
  onChange?: (change?: IStorageChange) => void
): IStorageReactiveQueryLease {
  /** Initialize native facts in original construction order before publishing any port. */
  const leaseState = { adapterState, terminal, onChange } as IReactiveLeaseContext

  if (leaseState.adapterState.adapterScope.lifecycle !== 'open')
    throw new StorageError(
      StorageErrorCode.reactiveAdapterNotInstalled,
      {},
      StorageErrorText.reactiveAdapterNotInstalled
    )

  leaseState.queryRecord = {}

  leaseState.queryOrder = 1_000_000 - leaseState.adapterState.nextQueryOrder++

  leaseState.released = false

  leaseState.subscriptionReleased = false

  leaseState.subscription =
    leaseState.onChange === undefined
      ? undefined
      : leaseState.adapterState.invalidations.subscribe((event) => {
          try {
            leaseState.onChange(event.value)
          } catch (error) {
            reportCleanupError(leaseState.adapterState.input.report, error)
          }
        })

  leaseState.lease = {
    release: () => {
      const failures: unknown[] = []
      releaseQuery(leaseState, (error) => failures.push(error))
      if (failures.length > 0) throw failures[0]
    },
    terminate: () => terminate(leaseState)
  }

  leaseState.adapterState.adapterScope.own(leaseState.queryRecord, {
    syncSafe: true,
    order: leaseState.queryOrder,
    force: () => {
      leaseState.adapterState.cleanupPromises?.push(terminate(leaseState))
    }
  })
  return leaseState.lease
}

/** Releases query admission and records every cleanup failure before one stable settlement. */
function releaseQuery(
  leaseState: IReactiveLeaseContext,
  recordFailure: (error: unknown) => void
): void {
  if (leaseState.released) return
  leaseState.released = true
  if (!leaseState.subscriptionReleased) {
    leaseState.subscriptionReleased = true
    try {
      leaseState.subscription?.()
    } catch (error) {
      recordFailure(error)
    }
  }
  try {
    leaseState.adapterState.adapterScope.release(leaseState.queryRecord)
  } catch (error) {
    recordFailure(error)
  }
}

function terminate(leaseState: IReactiveLeaseContext): Promise<void> {
  if (leaseState.terminalPromise !== undefined) return leaseState.terminalPromise
  const failures: unknown[] = []
  const recordFailure = (error: unknown): void => {
    failures.push(error)
  }
  let terminalResult: void | PromiseLike<void> = undefined
  try {
    terminalResult = leaseState.terminal?.(recordFailure)
  } catch (error) {
    recordFailure(error)
  }
  const finalize = (): void => {
    releaseQuery(leaseState, recordFailure)
    if (failures.length > 0)
      throw createStorageAggregateError(
        StorageErrorCode.liveQueryDisposeFailed,
        StorageErrorText.liveQueryDisposeFailed,
        failures
      )
  }
  leaseState.terminalPromise = Promise.resolve(terminalResult).then(
    () => finalize(),
    (error) => {
      recordFailure(error)
      return finalize()
    }
  )
  void leaseState.terminalPromise.catch(() => undefined)
  return leaseState.terminalPromise
}

/** Construct one Resource-backed query under this service's admitted adapter lifetime. */

/** One live query owns its Resource projection, cancellation admission and stable terminal result. */
type IReactiveQueryContext<T> = {
  /** Original adapters is captured before native construction begins. */
  readonly adapters: Map<string, IStorageReactiveAdapter>
  /** Original serviceScope is captured before native construction begins. */
  readonly serviceScope: ReturnType<typeof createLifecycleScope>
  /** Original input is captured before native construction begins. */
  readonly input: IStorageReactiveQueryInput<T>

  /** Published adapter handle retains the same native source and consistency facts. */
  adapter: IStorageReactiveAdapter

  /** Reject already-cancelled admission before allocating Resource state. */
  externallyAborted: boolean

  externalAbortReason: unknown

  /** Original Resource owns requests, generations and cached request data. */
  resource: Resource<T> | undefined

  /** Canonical same-runtime computed projection whose dependency is Resource.state. */
  computedState: IReactiveComputed<ILiveQueryState<T>> | undefined

  /** Cached terminal projection retained after lifecycle disposes the computed owner. */
  disposedState: ILiveQueryState<T> | undefined

  computedStateDisposed: boolean

  /** Stable listener identity used by both native registration and removal. */
  onExternalAbort: () => void

  /** Native signal subscription is released after terminal projection is captured. */
  removeExternalAbort: (recordFailure?: (error: unknown) => void) => void

  /** Stable outward cleanup port is installed before cancellation registration. */
  disposeQuery: () => Promise<void>

  /** Cancellation selection is retained through construction and cleanup races. */
  externalAbortObserved: boolean

  /** Records whether native cancellation acquisition began before allocation. */
  externalAbortRegistrationAttempted: boolean

  /** Tracks completed acquisition before listener cleanup may proceed. */
  externalAbortRegistrationReturned: boolean

  /** A cancellation listener is removed once across rollback and disposal. */
  externalAbortCleanupAttempted: boolean

  /** Stable explicit query cleanup result shared by all terminal callers. */
  disposePromise: Promise<void> | undefined

  /** First lifecycle error remains the outward terminal error after Resource cleanup. */
  terminalError: unknown

  /** Settles the one outward rejection gate before computed and Resource disposal. */
  rejectTerminal: (reason?: unknown) => void

  /** Stable lifecycle rejection gate shared by pending and post-terminal outward projections. */
  terminalPromise: Promise<never>

  /** Applies the caller equality policy while leaving request state owned by Resource. */
  visibleValue: T | undefined

  /** Distinguishes an actual undefined result from a query with no visible result. */
  hasVisibleValue: boolean

  /** Original adapter lease owns cleanup of this query projection and native invalidations. */
  lease: IStorageReactiveQueryLease

  /** Allocated Resource retained for outward request and promise projections. */
  queryResource: Resource<T>

  /** Immutable actual adapter consistency captured at query admission. */
  consistency: IReactiveConsistency

  /** Public state view delegates to the computed owner without exposing disposal authority. */
  publicState: ILiveQueryStateView<T>

  /** Original Resource promise identity used to cache the outward projection. */
  projectedPromiseSource: Promise<T> | undefined

  /** Stable void projection joins the actual request and lifecycle terminal gate. */
  projectedPromise: Promise<void> | undefined

  /** The first Resource generation starts only after every original owner is acquired. */
  initialRequest: Promise<T>

  /** Initial outward ready promise preserves its existing public identity. */
  ready: Promise<void>

  /** The symbolic entry reports the same cleanup while retaining a separate stable Promise. */
  symbolicDisposePromise: Promise<void> | undefined
}
/** Allocate one live query after validating its service, adapter and signal admission. */
function createReactiveQuery<T>(
  adapters: Map<string, IStorageReactiveAdapter>,
  serviceScope: ReturnType<typeof createLifecycleScope>,
  input: IStorageReactiveQueryInput<T>
): ILiveQuery<T> & IStorageResource {
  /** Initialize native facts in original construction order before publishing any port. */
  const queryState = { adapters, serviceScope, input } as IReactiveQueryContext<T>

  admitReactiveQuery(queryState)
  initializeReactiveQuery(queryState)
  allocateReactiveResource(queryState)
  allocateReactiveProjection(queryState)
  return publishReactiveQuery(queryState)
}

/** Report query diagnostics without replacing the original request or terminal outcome. */
function reportQuery<T>(queryState: IReactiveQueryContext<T>, error: unknown): void {
  try {
    const result = queryState.input.report?.(error)
    if (result !== undefined) void Promise.resolve(result).catch(() => undefined)
  } catch {
    // Query diagnostics are report-only and must not replace the query outcome.
  }
}

/** Apply equality while leaving native request state and generation ownership with Resource. */
function commitVisibleValue<T>(queryState: IReactiveQueryContext<T>, next: T): T {
  if (queryState.hasVisibleValue && queryState.input.equals !== undefined) {
    try {
      if (queryState.input.equals(queryState.visibleValue as T, next))
        return queryState.visibleValue as T
    } catch (error) {
      reportQuery(queryState, error)
    }
  }
  queryState.visibleValue = next
  queryState.hasVisibleValue = true
  return next
}

/** Captures the lifecycle-owned terminal identity before Resource cleanup or access. */
function markTerminal<T>(queryState: IReactiveQueryContext<T>): unknown {
  if (queryState.terminalError !== undefined) return queryState.terminalError
  const current = queryState.computedState?.peek()
  queryState.terminalError = queryState.externalAbortObserved
    ? new StorageContractError(StorageContractErrorCode.aborted, {
        cause: queryState.externalAbortReason
      })
    : new StorageError(StorageErrorCode.liveQueryDisposed, {}, StorageErrorText.liveQueryDisposed)
  const value = current !== undefined && 'value' in current ? { value: current.value } : {}
  queryState.disposedState = {
    status: LiveQueryStateStatus.disposed,
    ...value,
    error: queryState.terminalError
  } as ILiveQueryState<T>
  queryState.rejectTerminal(queryState.terminalError)
  return queryState.terminalError
}

/** Returns one handled stable rejection for every post-terminal outward operation. */
function terminalRejection<T>(queryState: IReactiveQueryContext<T>): Promise<never> {
  markTerminal(queryState)
  return queryState.terminalPromise
}

/** Attach terminal projection cleanup and filtered invalidation to the original adapter lease. */
function createReactiveQueryLease<T>(
  queryState: IReactiveQueryContext<T>
): IReactiveQueryContext<T>['lease'] {
  return queryState.adapter.acquireQuery(
    (recordFailure) => {
      markTerminal(queryState)
      try {
        queryState.resource?.dispose()
      } catch (error) {
        if (recordFailure === undefined) throw error
        recordFailure(error)
      }
      try {
        if (queryState.disposedState === undefined) markTerminal(queryState)
      } catch (error) {
        if (recordFailure === undefined) throw error
        recordFailure(error)
      }
      if (!queryState.computedStateDisposed) {
        queryState.computedStateDisposed = true
        try {
          queryState.computedState?.dispose()
        } catch (error) {
          if (recordFailure === undefined) throw error
          recordFailure(error)
        }
      }
      queryState.removeExternalAbort(recordFailure)
    },
    (change) => {
      if (
        change !== undefined &&
        queryState.input.scope !== undefined &&
        change.scope !== undefined &&
        change.scope !== queryState.input.scope
      )
        return
      let related = true
      if (change !== undefined && queryState.input.matches !== undefined) {
        try {
          related = queryState.input.matches(change)
        } catch (error) {
          reportQuery(queryState, error)
          related = true
        }
      }
      if (!related) return
      if (queryState.terminalError !== undefined) return
      if (queryState.resource === undefined) return
      try {
        const invalidation = queryState.resource.invalidate()
        void invalidation.catch(() => undefined)
      } catch {
        // Resource rejects late invalidation after terminal; terminal ownership already won.
      }
    }
  )
}

/** Rolls back construction in reverse acquisition order and preserves every original failure. */
function rollbackConstruction<T>(
  queryState: IReactiveQueryContext<T>,
  primary: unknown,
  cleanups: readonly (() => void)[]
): never {
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

/** Observes the caller signal before any Resource or computed allocation. */
function onExternalAbort<T>(queryState: IReactiveQueryContext<T>): void {
  queryState.externalAbortObserved = true
  queryState.externalAbortReason = queryState.input.signal?.reason
  if (queryState.resource !== undefined || queryState.computedState !== undefined) {
    try {
      void queryState.disposeQuery().catch((error) => reportQuery(queryState, error))
    } catch (error) {
      reportQuery(queryState, error)
    }
  }
}

/** Removes the caller-signal listener for construction rollback, preserving its failure. */
function cleanupExternalAbort<T>(queryState: IReactiveQueryContext<T>): void {
  let cleanupFailure: unknown
  let cleanupFailed = false
  queryState.removeExternalAbort((error) => {
    cleanupFailure = error
    cleanupFailed = true
  })
  if (cleanupFailed) throw cleanupFailure
}

/** Registers caller cancellation before any Resource exists, preserving zero-allocation abort. */
function registerExternalAbort<T>(queryState: IReactiveQueryContext<T>): void {
  if (queryState.input.signal === undefined) return
  queryState.externalAbortRegistrationAttempted = true
  try {
    queryState.input.signal.addEventListener('abort', queryState.onExternalAbort, {
      once: true
    })
    queryState.externalAbortRegistrationReturned = true
  } catch (cause) {
    queryState.externalAbortRegistrationReturned = true
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  if (queryState.externalAbortObserved || queryState.input.signal.aborted) {
    queryState.externalAbortObserved = true
    queryState.externalAbortReason = queryState.input.signal.reason
    throw new StorageContractError(StorageContractErrorCode.aborted, {
      cause: queryState.externalAbortReason
    })
  }
}

/** Projects the canonical Resource state into the public live-query state union. */
function projectResourceState<T>(queryState: IReactiveQueryContext<T>): ILiveQueryState<T> {
  if (queryState.terminalError !== undefined)
    return (
      queryState.disposedState ?? {
        status: LiveQueryStateStatus.disposed,
        error: queryState.terminalError
      }
    )
  const state = queryState.resource!.state
  if (state.status === 'success')
    return state.refreshing === true
      ? { status: LiveQueryStateStatus.refreshing, value: state.data }
      : { status: LiveQueryStateStatus.ready, value: state.data }
  if (state.status === 'error' || state.status === 'cancelled') {
    const value =
      queryState.hasVisibleValue && queryState.input.keepPreviousData !== false
        ? { value: queryState.visibleValue }
        : {}
    return {
      status: LiveQueryStateStatus.error,
      ...value,
      error: state.error
    } as ILiveQueryState<T>
  }
  return queryState.hasVisibleValue && queryState.input.keepPreviousData !== false
    ? { status: LiveQueryStateStatus.refreshing, value: queryState.visibleValue as T }
    : { status: LiveQueryStateStatus.loading }
}

/** Public state view delegates to the computed owner without exposing disposal authority. */
/** Expose computed state observations without exposing its cleanup authority. */
function createReactivePublicState<T>(
  queryState: IReactiveQueryContext<T>
): IReactiveQueryContext<T>['publicState'] {
  return {
    get runtime() {
      return queryState.input.runtime
    },
    get debugName() {
      return queryState.computedState?.debugName
    },
    get observed() {
      return queryState.computedStateDisposed ? false : queryState.computedState?.observed === true
    },
    get value() {
      if (queryState.computedStateDisposed)
        return (
          queryState.disposedState ?? {
            status: LiveQueryStateStatus.disposed,
            error: queryState.terminalError
          }
        )
      return queryState.computedState!.value
    },
    peek() {
      if (queryState.computedStateDisposed)
        return (
          queryState.disposedState ?? {
            status: LiveQueryStateStatus.disposed,
            error: queryState.terminalError
          }
        )
      return queryState.computedState!.peek()
    }
  } as ILiveQueryStateView<T>
}

/** Starts one Resource generation or joins its canonical current promise while fetching. */
function request<T>(queryState: IReactiveQueryContext<T>): Promise<T> {
  try {
    if (queryState.terminalError !== undefined) return terminalRejection(queryState)
    const current =
      queryState.queryResource.fetchStatus === 'fetching'
        ? queryState.queryResource.promise
        : queryState.queryResource.refetch()
    return current
  } catch (error) {
    return Promise.reject(error)
  }
}

/** Projects the exact current Resource promise without owning generation or request state. */
function projectCurrentPromise<T>(queryState: IReactiveQueryContext<T>): Promise<void> {
  if (queryState.terminalError !== undefined) return terminalRejection(queryState)
  let source: Promise<T>
  try {
    source = queryState.queryResource.promise
  } catch (error) {
    return Promise.reject(error)
  }
  if (queryState.projectedPromiseSource === source && queryState.projectedPromise !== undefined)
    return queryState.projectedPromise
  queryState.projectedPromiseSource = source
  const sourceProjection = source.then(
    () => {
      if (queryState.terminalError !== undefined) throw queryState.terminalError
      if (queryState.queryResource.fetchStatus === 'fetching')
        return projectCurrentPromise(queryState)
    },
    (error) => {
      if (queryState.terminalError !== undefined) throw queryState.terminalError
      if (queryState.queryResource.fetchStatus === 'fetching')
        return projectCurrentPromise(queryState)
      throw error
    }
  )
  queryState.projectedPromise = Promise.race([sourceProjection, queryState.terminalPromise])
  void queryState.projectedPromise.catch(() => undefined)
  return queryState.projectedPromise
}

/** Dispose registered adapters once through the original asynchronous service lifecycle. */
function disposeReactiveService(serviceState: IReactiveServiceContext): Promise<void> {
  if (serviceState.serviceDisposePromise !== undefined) return serviceState.serviceDisposePromise
  serviceState.serviceDisposePromise = serviceState.serviceScope.dispose().then((failures) => {
    for (const failure of failures) reportCleanupError(() => undefined, failure.error)
  })
  return serviceState.serviceDisposePromise
}

/** Resolve an admitted adapter without creating a fallback source or lifetime. */
function requireReactiveAdapter(
  adapters: Map<string, IStorageReactiveAdapter>,
  backendId: string
): IStorageReactiveAdapter {
  const adapter = adapters.get(backendId)
  if (adapter === undefined)
    throw new StorageError(
      StorageErrorCode.reactiveAdapterNotInstalled,
      {},
      StorageErrorText.reactiveAdapterNotInstalled
    )
  return adapter
}

/** Validate service, adapter and cancellation admission before allocating any query resource. */
function admitReactiveQuery<T>(queryState: IReactiveQueryContext<T>): void {
  if (queryState.serviceScope.lifecycle !== 'open')
    throw new StorageError(
      StorageErrorCode.reactiveAdapterNotInstalled,
      {},
      StorageErrorText.reactiveAdapterNotInstalled
    )

  queryState.adapter = requireReactiveAdapter(queryState.adapters, queryState.input.backendId)

  /** Reject already-cancelled admission before allocating Resource state. */
  queryState.externallyAborted = queryState.input.signal?.aborted ?? false

  queryState.externalAbortReason = queryState.externallyAborted
    ? queryState.input.signal?.reason
    : undefined

  if (queryState.externallyAborted)
    throw new StorageContractError(StorageContractErrorCode.aborted, {
      cause: queryState.externalAbortReason
    })

  if (
    (queryState.input.scope !== undefined && typeof queryState.input.scope !== 'string') ||
    (queryState.input.matches !== undefined && typeof queryState.input.matches !== 'function') ||
    (queryState.input.equals !== undefined && typeof queryState.input.equals !== 'function') ||
    (queryState.input.report !== undefined && typeof queryState.input.report !== 'function') ||
    (queryState.input.timeoutMs !== undefined &&
      (!Number.isFinite(queryState.input.timeoutMs) || queryState.input.timeoutMs < 0))
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
}
/** Initialize stable terminal state and register the original adapter lease. */
function initializeReactiveQuery<T>(queryState: IReactiveQueryContext<T>): void {
  queryState.computedStateDisposed = false

  queryState.externalAbortObserved = false

  queryState.externalAbortRegistrationAttempted = false

  queryState.externalAbortRegistrationReturned = false

  queryState.externalAbortCleanupAttempted = false

  /** Stable lifecycle rejection gate shared by pending and post-terminal outward projections. */
  queryState.terminalPromise = new Promise<never>((_resolve, reject) => {
    queryState.rejectTerminal = reject
  })

  void queryState.terminalPromise.catch(() => undefined)

  queryState.hasVisibleValue = false
  queryState.lease = createReactiveQueryLease(queryState)

  /** Terminates the lifecycle lease and Resource exactly once, even during construction races. */
  queryState.disposeQuery = () => {
    if (queryState.disposePromise !== undefined) return queryState.disposePromise
    markTerminal(queryState)
    queryState.disposePromise = queryState.lease.terminate()
    void queryState.disposePromise.catch(() => undefined)
    return queryState.disposePromise
  }

  /** Keep the same callback object across registration and cleanup. */
  queryState.onExternalAbort = () => onExternalAbort(queryState)

  /** Removes the pre-allocation caller-signal listener exactly once. */
  queryState.removeExternalAbort = (recordFailure): void => {
    if (
      queryState.input.signal === undefined ||
      !queryState.externalAbortRegistrationAttempted ||
      !queryState.externalAbortRegistrationReturned ||
      queryState.externalAbortCleanupAttempted
    )
      return
    queryState.externalAbortCleanupAttempted = true
    try {
      queryState.input.signal.removeEventListener('abort', queryState.onExternalAbort)
    } catch (error) {
      if (recordFailure === undefined) reportQuery(queryState, error)
      else recordFailure(error)
    }
  }
}
/**
 * Admit external cancellation before Resource construction, rolling back the original lease on
 * failure.
 */
function allocateReactiveResource<T>(queryState: IReactiveQueryContext<T>): void {
  /** Creates the Resource after lifecycle and external-abort admission have both succeeded. */
  try {
    registerExternalAbort(queryState)
  } catch (error) {
    rollbackConstruction(queryState, error, [
      queryState.lease.release,
      () => cleanupExternalAbort(queryState)
    ])
  }

  try {
    queryState.resource = new Resource<T>(
      ({ signal }) => {
        const operation = ({
          signal: operationSignal
        }: {
          readonly signal: import('@migaia/utils/promise').INativeAbortSignal
        }) =>
          queryState.input.query({
            store: queryState.adapter.store,
            signal: operationSignal,
            scope: queryState.input.scope
          })
        const request =
          queryState.input.timeoutMs === undefined
            ? raceWithAbort(operation, {
                signal,
                report: (error) => reportQuery(queryState, error)
              })
            : withTimeout(operation, {
                timeoutMs: queryState.input.timeoutMs,
                signal,
                scheduler: queryState.input.scheduler,
                report: (error) => reportQuery(queryState, error)
              })
        return request
          .then((next) => commitVisibleValue(queryState, next))
          .catch((cause) => {
            if (cause instanceof StorageContractError) throw cause
            throw new StorageError(
              StorageErrorCode.extensionFailed,
              { cause, operation: 'liveQuery' },
              StorageErrorText.liveQueryFailed
            )
          })
      },
      queryState.input.runtime,
      {
        autoStart: false,
        ttl: Infinity,
        retry: 0,
        staleWhileRevalidate: queryState.input.keepPreviousData ?? true,
        keepAlive: true,
        scheduler: queryState.input.scheduler
      }
    )
  } catch (error) {
    rollbackConstruction(queryState, error, [
      queryState.lease.release,
      () => cleanupExternalAbort(queryState)
    ])
  }
}
/** Derive the public computed projection and actual adapter consistency from the same Resource. */
function allocateReactiveProjection<T>(queryState: IReactiveQueryContext<T>): void {
  /** Same-runtime computed owner derives directly from Resource's reactive state signal. */
  try {
    queryState.computedState = queryState.input.runtime.computed(
      () => projectResourceState(queryState),
      {
        keepAlive: true,
        debugName: 'storage-web/live-query-state'
      }
    )
  } catch (error) {
    rollbackConstruction(queryState, error, [
      queryState.lease.release,
      () => cleanupExternalAbort(queryState),
      () => queryState.resource!.dispose()
    ])
  }

  queryState.queryResource = queryState.resource!

  /** Immutable actual adapter consistency captured at query admission. */
  queryState.consistency = {
    mode: queryState.adapter.consistency.mode,
    visibility: queryState.adapter.consistency.visibility,
    ...(queryState.adapter.consistency.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: queryState.adapter.consistency.pollIntervalMs })
  } as IReactiveConsistency
  queryState.publicState = createReactivePublicState(queryState)
}
/** Start the first generation only after all original resource owners have been acquired. */
function publishReactiveQuery<T>(
  queryState: IReactiveQueryContext<T>
): ILiveQuery<T> & IStorageResource {
  queryState.initialRequest = request(queryState)

  void queryState.initialRequest.catch(() => undefined)

  if (queryState.externalAbortObserved) {
    void queryState.disposeQuery().catch((error) => reportQuery(queryState, error))
    throw new StorageContractError(StorageContractErrorCode.aborted, {
      cause: queryState.externalAbortReason
    })
  }

  queryState.ready = projectCurrentPromise(queryState)

  void queryState.ready.catch(() => undefined)
  return {
    [asyncDisposeKey]: () =>
      (queryState.symbolicDisposePromise ??= queryState
        .disposeQuery()
        .catch((error: unknown) => reportQuery(queryState, error))),
    state: queryState.publicState,
    consistency: queryState.consistency,
    ready: queryState.ready,
    refresh: () => {
      const current = request(queryState)
      void current.catch(() => undefined)
      return projectCurrentPromise(queryState)
    },
    dispose: queryState.disposeQuery
  }
}
