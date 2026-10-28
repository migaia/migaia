import { createEventChannel } from '@migaia/event-subscriber'
import { createSyncLifecycleScope, createLifecycleScope } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { Resource } from '@migaia/resource'
import type { IRuntime } from '@migaia/reactive'
import {
  createStorageAggregateError,
  createStorageTypeError,
  StorageError
} from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import type { IBackendChangeController } from '@migaia/storage-host/sdk'
import { reportCleanupError } from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageBase,
  type IStorageResource,
  type IStorageChange
} from '@migaia/storage-contract'
import { raceWithAbort, withTimeout } from '@migaia/utils/promise'
import type { ILiveQuery, IReactiveConsistency, IStorageReactiveFeatureMetadata } from './types.ts'
import { isStorageReactiveVisibility } from './state-constants.ts'
import {
  createReactiveQuery,
  createReactiveQueryLease,
  markTerminal,
  onExternalAbort,
  reportQuery,
  registerExternalAbort,
  rollbackConstruction,
  cleanupExternalAbort,
  commitVisibleValue,
  projectResourceState,
  createReactivePublicState,
  request,
  projectCurrentPromise
} from './reactive-query.ts'
import type { IReactiveQueryContext } from './reactive-query.ts'

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
    readonly report: (error: unknown) => void
  }) => IStorageReactiveAdapter
  readonly createQuery: <T>(
    input: IStorageReactiveQueryInput<T>
  ) => ILiveQuery<T> & IStorageResource
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
export function createStorageReactiveService(): IStorageReactiveService {
  /** Initialize native facts in original construction order before publishing any port. */
  const serviceState = {} as IReactiveServiceContext

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
      readonly report: (error: unknown) => void
    }) => registerAdapter(serviceState, input),
    createQuery: <T>(input: IStorageReactiveQueryInput<T>) =>
      createReactiveQuery(serviceState.adapters, serviceState.serviceScope, input),
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
    readonly report: (error: unknown) => void
  }

  /**
   * Admitted adapter facts retained across awaited query generations exposed to every query as
   * actual consistency.
   */
  actualConsistency: IStorageReactiveFeatureMetadata

  /** Original synchronous owner preserves source-before-query teardown in the same turn. */
  adapterScope: ReturnType<typeof createSyncLifecycleScope>

  /** Canonical event channel owns invalidation fanout and subscription ordering. */
  invalidations: ReturnType<typeof createEventChannel<IStorageChange | undefined>>

  /** Stable source resource has the highest teardown priority within the adapter. */
  sourceRecord: object

  /** Native controller subscription is released before the adapter's admitted queries. */
  sourceStop: (() => void) | undefined

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
      StorageBrowserErrorCode.reactiveFeatureInvalid,
      {},
      StorageErrorText.reactiveFeatureInvalid
    )

  if (
    adapterState.input.controller === undefined &&
    adapterState.input.consistency.mode !== 'polling'
  )
    throw new StorageError(
      StorageBrowserErrorCode.reactiveFeatureInvalid,
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
      StorageBrowserErrorCode.reactiveFeatureInvalid,
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

  adapterState.invalidations = createEventChannel<IStorageChange | undefined>({
    dispatchPolicy: 'queued',
    report: (error) => reportCleanupError(adapterState.input.report, error)
  })

  adapterState.sourceRecord = {}

  adapterState.nextQueryOrder = 0

  /** Source gets the highest release order, enforcing source-before-query same-tick order. */
  adapterState.adapterScope.own(adapterState.sourceRecord, {
    syncSafe: true,
    order: Number.MAX_SAFE_INTEGER,
    force: () => {
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

/** Publishes one backend invalidation; event-subscriber owns fanout snapshot/order. */
function publishChange(adapterState: IReactiveAdapterContext, change?: IStorageChange): void {
  try {
    adapterState.invalidations.publish(change)
  } catch (error) {
    reportCleanupError(adapterState.input.report, error)
  }
}

/** Subscribe through the installed native controller; polling adapters need no source lease. */
function startSource(adapterState: IReactiveAdapterContext): void {
  if (adapterState.adapterScope.lifecycle !== 'open') return
  try {
    adapterState.sourceStop = adapterState.input.controller?.subscribe((change) =>
      publishChange(adapterState, change)
    )
  } catch (error) {
    adapterState.adapterScope.close()
    throw createStorageTypeError(
      StorageBrowserErrorCode.reactiveFeatureInvalid,
      StorageErrorText.reactiveFeatureInvalid,
      error
    )
  }
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
      StorageBrowserErrorCode.reactiveAdapterNotInstalled,
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
        StorageBrowserErrorCode.liveQueryDisposeFailed,
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
      StorageBrowserErrorCode.reactiveAdapterNotInstalled,
      {},
      StorageErrorText.reactiveAdapterNotInstalled
    )
  return adapter
}

/** Validate service, adapter and cancellation admission before allocating any query resource. */
export function admitReactiveQuery<T>(queryState: IReactiveQueryContext<T>): void {
  if (queryState.serviceScope.lifecycle !== 'open')
    throw new StorageError(
      StorageBrowserErrorCode.reactiveAdapterNotInstalled,
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
export function initializeReactiveQuery<T>(queryState: IReactiveQueryContext<T>): void {
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
export function allocateReactiveResource<T>(queryState: IReactiveQueryContext<T>): void {
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
              StorageBrowserErrorCode.extensionFailed,
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
export function allocateReactiveProjection<T>(queryState: IReactiveQueryContext<T>): void {
  /** Same-runtime computed owner derives directly from Resource's reactive state signal. */
  try {
    queryState.computedState = queryState.input.runtime.computed(
      () => projectResourceState(queryState),
      {
        keepAlive: true,
        debugName: 'storage-plugin-browser/live-query-state'
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
export function publishReactiveQuery<T>(
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
