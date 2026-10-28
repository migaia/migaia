// Reactive query context, leases, external aborts and public state projection for the reactive service (see ./reactive.ts).
import { hostRethrowReporter } from '@migaia/utils/promise'
import { createLifecycleScope } from '@migaia/lifecycle'
import { Resource } from '@migaia/resource'
import type { IReactiveComputed } from '@migaia/reactive'
import { createStorageAggregateError, StorageError } from '../types/errors.js'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageResource
} from '@migaia/storage-contract'
import type {
  ILiveQuery,
  ILiveQueryState,
  ILiveQueryStateView,
  IReactiveConsistency
} from './types.js'
import { LiveQueryStateStatus } from './state-constants.js'
import {
  admitReactiveQuery,
  initializeReactiveQuery,
  allocateReactiveResource,
  allocateReactiveProjection,
  publishReactiveQuery
} from './reactive.js'
import type {
  IStorageReactiveAdapter,
  IStorageReactiveQueryInput,
  IStorageReactiveQueryLease
} from './reactive.js'

/** Construct one Resource-backed query under this service's admitted adapter lifetime. */

/** One live query owns its Resource projection, cancellation admission and stable terminal result. */
export type IReactiveQueryContext<T> = {
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
export function createReactiveQuery<T>(
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

/**
 * Hand a failed report callback's own error to the host unhandled-error channel. The utils
 * reporter's context names utils operations only and is not read by the host channel.
 */
function rethrowReportFailure(failure: unknown): void {
  ;(hostRethrowReporter as (error: unknown) => void)(failure)
}

/** Report query diagnostics without replacing the original request or terminal outcome. */
export function reportQuery<T>(queryState: IReactiveQueryContext<T>, error: unknown): void {
  /** A failing report callback never replaces the query outcome; its own failure goes to the host. */
  try {
    const result = queryState.input.report?.(error)
    if (result !== undefined) void Promise.resolve(result).catch(rethrowReportFailure)
  } catch (failure) {
    rethrowReportFailure(failure)
  }
}

/** Apply equality while leaving native request state and generation ownership with Resource. */
export function commitVisibleValue<T>(queryState: IReactiveQueryContext<T>, next: T): T {
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
export function markTerminal<T>(queryState: IReactiveQueryContext<T>): unknown {
  if (queryState.terminalError !== undefined) return queryState.terminalError
  const current = queryState.computedState?.peek()
  queryState.terminalError = queryState.externalAbortObserved
    ? new StorageContractError(StorageContractErrorCode.aborted, {
        cause: queryState.externalAbortReason
      })
    : new StorageError(
        StorageBrowserErrorCode.liveQueryDisposed,
        {},
        StorageErrorText.liveQueryDisposed
      )
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
export function createReactiveQueryLease<T>(
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
export function rollbackConstruction<T>(
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
    StorageBrowserErrorCode.liveQueryDisposeFailed,
    StorageErrorText.liveQueryDisposeFailed,
    failures
  )
}

/** Observes the caller signal before any Resource or computed allocation. */
export function onExternalAbort<T>(queryState: IReactiveQueryContext<T>): void {
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
export function cleanupExternalAbort<T>(queryState: IReactiveQueryContext<T>): void {
  let cleanupFailure: unknown
  let cleanupFailed = false
  queryState.removeExternalAbort((error) => {
    cleanupFailure = error
    cleanupFailed = true
  })
  if (cleanupFailed) throw cleanupFailure
}

/** Registers caller cancellation before any Resource exists, preserving zero-allocation abort. */
export function registerExternalAbort<T>(queryState: IReactiveQueryContext<T>): void {
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
export function projectResourceState<T>(queryState: IReactiveQueryContext<T>): ILiveQueryState<T> {
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
export function createReactivePublicState<T>(
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
export function request<T>(queryState: IReactiveQueryContext<T>): Promise<T> {
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
export function projectCurrentPromise<T>(queryState: IReactiveQueryContext<T>): Promise<void> {
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
