import {
  StorageContractError,
  StorageContractErrorCode,
  type IBackendKind,
  type IKeyValueStore,
  type IStorageChange,
  type IStorageKey
} from '@migaia/storage-contract'
import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'
import { createStringLeaseRegistry } from '@migaia/lifecycle'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'
import { REPOSITORY_KEY_PREFIX } from '../entity/key.js'

/** Construction-time references and options retained by the private adapter seam. */
export type IBackendReactiveSnapshot = {
  readonly backend: IBackendKind
  readonly platform: object | undefined
  readonly options: object | undefined
}

/** Private lifecycle and commit-after event owner shared by direct and Host-created stores. */
export type IBackendReactiveController = {
  readonly snapshot: IBackendReactiveSnapshot
  readonly origin: string
  beginMutation(): () => void
  publish(change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): IStorageChange | undefined
  publishExternal(change: IStorageChange): void
  subscribe(listener: (change: IStorageChange) => void): () => void
  dispose(): Promise<void>
}

type IBackendReactiveControllerOptions = {
  readonly backend: IBackendKind
  readonly platform?: object
  readonly options?: object
  /**
   * Optional backend-owned origin; cross-realm transports must not derive identity from a local
   * counter.
   */
  readonly origin?: string
}

/** One private exact-store registration per factory-created store. */
const controllerRegistry = new WeakMap<IKeyValueStore, IBackendReactiveController>()

/** Monotonic fallback for unique same-realm event origins. */
let controllerOriginSequence = 0

/** Construct a controller without exposing its event channel or lifecycle state publicly. */
export const createBackendReactiveController = (
  input: IBackendReactiveControllerOptions
): IBackendReactiveController => {
  const snapshot: IBackendReactiveSnapshot = Object.freeze({
    backend: input.backend,
    platform: input.platform,
    options: input.options
  })
  const origin = input.origin ?? `${input.backend}:${(controllerOriginSequence += 1).toString(36)}`
  let sequence = 0
  let disposed = false
  let disposeRequested = false
  let disposePromise: Promise<void> | undefined
  const mutationLeases = createStringLeaseRegistry()
  const mutationLeaseKey = 'backend-mutation'
  const reporter = createStorageOperationReporter()
  const channel = createEventChannel<IStorageChange>({
    report: ({ error }) => reportCleanupError(reporter, error),
    dispatchPolicy: EventDispatchPolicy.queued
  })
  const maxEventKeys = 128

  /** Read the canonical entity scope used by coarse record invalidations. */
  const canonicalScopeOf = (key: IStorageKey): string | undefined =>
    Array.isArray(key) &&
    key.length === 3 &&
    key[0] === REPOSITORY_KEY_PREFIX &&
    typeof key[1] === 'string' &&
    typeof key[2] === 'string'
      ? key[1]
      : undefined

  /** Derive a scope only when every retained record key belongs to that same scope. */
  const deriveScope = (keys: readonly IStorageKey[] | undefined): string | undefined => {
    if (keys === undefined || keys.length === 0) return undefined
    const first = canonicalScopeOf(keys[0]!)
    if (first === undefined) return undefined
    return keys.every((key) => canonicalScopeOf(key) === first) ? first : undefined
  }

  /** Finish controller disposal once lifecycle-owned commit, publication, and transport work drains. */
  const finishDispose = (): void => {
    if (disposed) return
    disposed = true
    channel.clear()
  }

  /** Fan out one already validated local or transport event without changing its metadata identity. */
  const emit = (event: IStorageChange): void => {
    if (disposed) return
    try {
      channel.publish(event)
    } catch (cause) {
      reportCleanupError(reporter, cause)
    }
  }

  const controller: IBackendReactiveController = {
    snapshot,
    origin,
    beginMutation: () => {
      if (disposeRequested || disposed)
        throw new StorageContractError(StorageContractErrorCode.disposed, {
          backend: input.backend
        })
      return mutationLeases.retain(mutationLeaseKey)
    },
    publish: (change) => {
      if (disposed) return
      sequence += 1
      const keys =
        change.keys !== undefined && change.keys.length > maxEventKeys ? undefined : change.keys
      const event: IStorageChange = {
        ...change,
        keys,
        scope: change.channel === 'record' ? deriveScope(change.keys) : undefined,
        sequence,
        origin
      }
      emit(event)
      return event
    },
    publishExternal: (change) => {
      if (disposed) return
      const keys =
        change.keys !== undefined && change.keys.length > maxEventKeys ? undefined : change.keys
      emit({
        ...change,
        keys,
        scope: change.channel === 'record' ? deriveScope(keys) : undefined
      })
    },
    subscribe: (listener) => channel.subscribe((event) => listener(event.value)),
    dispose: () => {
      if (disposePromise !== undefined) return disposePromise
      disposeRequested = true
      mutationLeases.seal(mutationLeaseKey)
      disposePromise = mutationLeases.whenZero(mutationLeaseKey).then(finishDispose)
      return disposePromise
    }
  }
  return controller
}

/** Register one exact store instance and reject accidental duplicate ownership. */
export const registerBackendReactiveController = (
  store: IKeyValueStore,
  controller: IBackendReactiveController
): void => {
  if (controllerRegistry.has(store))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: store.backend
    })
  controllerRegistry.set(store, controller)
}

/** Look up the package-private controller bound to one exact store instance. */
export const getBackendReactiveController = (
  store: unknown
): IBackendReactiveController | undefined => {
  if (typeof store !== 'object' || store === null) return undefined
  return controllerRegistry.get(store as IKeyValueStore)
}
