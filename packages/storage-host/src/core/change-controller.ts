import {
  StorageContractError,
  StorageContractErrorCode,
  type IBackendKind,
  type IStorageBase,
  type IStorageChange,
  type IStorageKey,
  type IWriteOptions
} from '@migaia/storage-contract'
import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'
import { createStringLeaseRegistry, createAbortController } from '@migaia/lifecycle'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { IdentifyError, isNativeErrorValue } from '@migaia/utils/error'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'
import { REPOSITORY_KEY_PREFIX } from './record-layout.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import type { IStorageEnvelopeStages } from '../types.js'

/** Construction-time references and options retained by the backend authoring boundary. */
export type IBackendChangeSnapshot = {
  readonly backend: IBackendKind
  readonly platform: object | undefined
  readonly options: object | undefined
}

/** Original lifecycle and commit-after event owner, shared by admitted backend instances. */
export type IBackendChangeController = {
  readonly snapshot: IBackendChangeSnapshot
  readonly origin: string
  readonly closingSignal: INativeAbortSignal
  assertLive(): void
  beginMutation(): () => void
  publish(change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): IStorageChange | undefined
  publishExternal(change: IStorageChange): void
  subscribe(listener: (change: IStorageChange) => void): () => void
  dispose(): Promise<void>
}

export type IBackendChangeControllerOptions = {
  readonly backend: IBackendKind
  readonly platform?: object
  readonly options?: object
  /**
   * Optional backend-owned origin; cross-realm transports must not derive identity from a local
   * counter.
   */
  readonly origin?: string
  /** Concrete backend cleanup run after admitted mutations drain and before terminal state. */
  readonly finalize?: () => void | Promise<void>
}

/** Prepared text mutation checked and committed by the backend's original physical owner. */
export type IBackendValueCommit = (
  input: Readonly<{
    prefix: string
    expected: readonly (readonly [string, string])[]
    key: string
    value: string
  }>,
  ctx?: IWriteOptions
) => Promise<void>

/** Original exact-store row shares optional change and envelope observation bindings. */
type IBackendRegistration = {
  controller?: IBackendChangeController
  valueCommit?: IBackendValueCommit
  envelope?: (
    operation: Readonly<{ operation: string; targetVersion: number }>
  ) => IStorageEnvelopeStages
}

/** One private exact-store registry; observation also supports admitted stores without a controller. */
const controllerRegistry = new WeakMap<IStorageBase, IBackendRegistration>()

/** Monotonic fallback for unique same-realm event origins. */
let controllerOriginSequence = 0

/** Construct a controller without exposing its event channel or lifecycle state publicly. */
export const createBackendChangeController = (
  input: IBackendChangeControllerOptions
): IBackendChangeController => {
  /** Capture author fields once while retaining the original callback receiver. */
  let options: IBackendChangeControllerOptions
  try {
    options = {
      backend: input.backend,
      platform: input.platform,
      options: input.options,
      origin: input.origin,
      finalize: input.finalize
    }
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  if (
    typeof options.backend !== 'string' ||
    (options.origin !== undefined && typeof options.origin !== 'string') ||
    (options.finalize !== undefined && typeof options.finalize !== 'function')
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  /** Native platform and captured construction options remain original borrowed references. */
  const snapshot: IBackendChangeSnapshot = Object.freeze({
    backend: options.backend,
    platform: options.platform,
    options: options.options
  })
  /** Existing origins preserve native transport identity or a unique same-realm fallback. */
  const origin =
    options.origin ?? `${options.backend}:${(controllerOriginSequence += 1).toString(36)}`
  /** Only committed local publications advance this controller's original sequence. */
  let sequence = 0
  /** Physical disposal clears the original channel after all mutation leases drain. */
  let disposed = false
  /** The original logical closure signal seals new work and cancels only pending admissions. */
  const closing = createAbortController()
  /** All callers await the same original controller cleanup Promise. */
  let disposePromise: Promise<void> | undefined
  /** Existing lifecycle leases own admitted mutations; no backend queue is introduced. */
  const mutationLeases = createStringLeaseRegistry()
  /** One local lease lane groups this controller's actual mutation work. */
  const mutationLeaseKey = 'backend-mutation'
  /** Observer errors reach the original final diagnostic adapter. */
  const reporter = createStorageOperationReporter()
  /** The original event channel preserves queued reentrant delivery. */
  const channel = createEventChannel<IStorageChange>({
    report: ({ error }) => reportCleanupError(reporter, error),
    dispatchPolicy: EventDispatchPolicy.queued
  })
  /** Large commits keep coarse invalidation instead of retaining more than the original bound. */
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
    /** All retained keys must agree with the original canonical entity scope. */
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

  /** One controller object retains its original native resource and notification identity. */
  const controller: IBackendChangeController = {
    snapshot,
    origin,
    closingSignal: closing.signal,
    assertLive: () => {
      if (closing.signal.aborted || disposed)
        throw new StorageContractError(StorageContractErrorCode.disposed, {
          backend: options.backend
        })
    },
    beginMutation: () => {
      controller.assertLive()
      return mutationLeases.retain(mutationLeaseKey)
    },
    publish: (change) => {
      if (disposed) return
      sequence += 1
      /** Omit oversized key sets while retaining the original coarse scope derivation. */
      const keys =
        change.keys !== undefined && change.keys.length > maxEventKeys ? undefined : change.keys
      /** Local publication retains all caller metadata and adds only original sequence/origin. */
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
      /** External publication retains its source sequence rather than advancing the local counter. */
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
      mutationLeases.seal(mutationLeaseKey)
      disposePromise = mutationLeases.whenZero(mutationLeaseKey).then(async () => {
        try {
          if (options.finalize !== undefined) await Reflect.apply(options.finalize, input, [])
        } catch (cause) {
          // Preserve an existing backend failure; raw callbacks gain the host cleanup boundary.
          if (isNativeErrorValue(cause) && IdentifyError.identityOf(cause) !== undefined)
            throw cause
          throw new StorageError(
            StorageErrorCode.storageHostDisposeFailed,
            { backend: options.backend, cause },
            StorageErrorText.storageHostDisposeFailed
          )
        } finally {
          finishDispose()
        }
      })
      /** Cache the original primary before notifying listeners, which may reenter disposal. */
      closing.abort(
        new StorageContractError(StorageContractErrorCode.disposed, {
          backend: options.backend
        })
      )
      return disposePromise
    }
  }
  return controller
}

/** Register one exact store instance and reject accidental duplicate ownership. */
export const registerBackendChangeController = (
  store: IStorageBase,
  controller: IBackendChangeController
): (() => void) => {
  if (controllerRegistry.get(store)?.controller !== undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: store.backend
    })
  /** Admission may already have bound envelope observation to this original row. */
  const row = controllerRegistry.get(store) ?? {}
  row.controller = controller
  controllerRegistry.set(store, row)
  return () => {
    if (controllerRegistry.get(store) !== row || row.controller !== controller) return
    delete row.controller
    if (row.envelope === undefined && row.valueCommit === undefined)
      controllerRegistry.delete(store)
  }
}

/** Look up the package-private controller bound to one exact store instance. */
export const getBackendChangeController = (
  store: unknown
): IBackendChangeController | undefined => {
  if (typeof store !== 'object' || store === null) return undefined
  return controllerRegistry.get(store as IStorageBase)?.controller
}

/** Bind original host observation at resource admission without changing or patching the store. */
export const registerBackendEnvelopeStages = (
  store: IStorageBase,
  factory: NonNullable<IBackendRegistration['envelope']>
): (() => void) => {
  /** The same row remains the sole owner of optional controller and envelope references. */
  const row = controllerRegistry.get(store) ?? {}
  row.envelope = factory
  controllerRegistry.set(store, row)
  return () => {
    if (controllerRegistry.get(store) !== row || row.envelope !== factory) return
    delete row.envelope
    if (row.controller === undefined && row.valueCommit === undefined)
      controllerRegistry.delete(store)
  }
}

/** Entity operations borrow the admitted host observer without gaining construction authority. */
export const getBackendEnvelopeStages = (
  store: IStorageBase,
  operation: Readonly<{ operation: string; targetVersion: number }>
): IStorageEnvelopeStages | undefined => controllerRegistry.get(store)?.envelope?.(operation)

/** Install one original native compare-and-write terminal on the exact admitted store row. */
export const registerBackendValueCommit = (
  store: IStorageBase,
  commit: IBackendValueCommit
): (() => void) => {
  if (typeof commit !== 'function' || controllerRegistry.get(store)?.valueCommit !== undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  /** This uses the same original row as resource observation and change publication. */
  const row = controllerRegistry.get(store) ?? {}
  row.valueCommit = commit
  controllerRegistry.set(store, row)
  return () => {
    if (controllerRegistry.get(store) !== row || row.valueCommit !== commit) return
    delete row.valueCommit
    if (row.controller === undefined && row.envelope === undefined) controllerRegistry.delete(store)
  }
}

/** Entity borrows the captured native endpoint without exposing its registration authority. */
export const getBackendValueCommit = (store: IStorageBase): IBackendValueCommit | undefined =>
  controllerRegistry.get(store)?.valueCommit
