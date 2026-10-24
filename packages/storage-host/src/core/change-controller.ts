import {
  StorageContractError,
  StorageContractErrorCode,
  isSecondaryIndexRecordStore,
  records,
  type IOperationContext,
  type IStorageIterator,
  type IBackendKind,
  type IStorageBase,
  type IStorageChange,
  type IStorageKey,
  type IWriteOptions,
  type IKeyValueStore,
  type IRecordStore,
  type ISecondaryIndexRecordStore,
  type ITransactionInfo
} from '@migaia/storage-contract'
import { snapshotRecordStore, snapshotKeyValueStoreDetailed } from '../authoring/store.js'
import { assertTransactionOwner } from '../authoring/transaction.js'
import { hasStorageCapability, useStorageCapability } from '../authoring/capability.js'
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

/** Each original host supplies observation and optional selected query methods on its own binding. */
type IBackendEntityBinding = {
  readonly envelope: (
    operation: Readonly<{ operation: string; targetVersion: number }>
  ) => IStorageEnvelopeStages
  readonly queryMethods?: () => object | undefined
}

/** Original exact-store row shares optional controller, entity observation and native endpoints. */
type IBackendRegistration = {
  controller?: IBackendChangeController
  valueCommit?: IBackendValueCommit
  envelopes?: IBackendEntityBinding[]
  entity?: IBackendEntityAccess
}

/** Entity methods retain business access while omitting every resource ownership member. */
export type IEntityKeyValueMethods = Omit<IKeyValueStore, 'dispose' | typeof Symbol.asyncDispose>
/** Record methods preserve their original native transaction owner and metadata. */
export type IEntityRecordMethods = Omit<IRecordStore, 'dispose' | typeof Symbol.asyncDispose>
/** Secondary methods retain canonical admission while the native target stays private. */
export type IEntitySecondaryMethods = Omit<
  ISecondaryIndexRecordStore,
  'dispose' | typeof Symbol.asyncDispose
>
/** The original exact-store row grants only already-authenticated business facts to entity. */
export type IBackendEntityAccess = {
  readonly store: IEntityKeyValueMethods
  recordStore(): IEntityRecordMethods | undefined
  secondaryStore(): IEntitySecondaryMethods | undefined
  assertScope(scope: object): ITransactionInfo
  assertCurrent(): void
  /** Borrow only the original native record-query watcher; it grants no store or resource authority. */
  readonly watchRecords?: (ctx?: IOperationContext) => IStorageIterator<IStorageChange>
  readonly valueCommit?: IBackendValueCommit
}

/**
 * Capture a genuine native query method through the original token Map, without mutating or
 * unwrapping it.
 */
export function snapshotBackendEntityRecordWatcher(
  native: IStorageBase
): IBackendEntityAccess['watchRecords'] {
  if (native.capabilities.changeFeed !== true || !hasStorageCapability(native, records)) return
  /** Query construction is pure; every invocation below still returns its original fresh iterator. */
  const query = useStorageCapability(native, records).query() as {
    readonly watch?: (ctx?: IOperationContext) => IStorageIterator<IStorageChange>
  }
  if (typeof query.watch !== 'function') return
  return (ctx) => query.watch!(ctx)
}

/** Bind only an original host-authenticated alias, keeping its native owner private in a closure. */
export function registerBackendEntityAccess(
  view: object,
  native: IStorageBase,
  assertCurrent: () => void
): () => void {
  /** The same canonical KV admission validates this native target before ownership is hidden. */
  const keyValue = snapshotKeyValueStoreDetailed(native)
  if (!keyValue.valid) return () => undefined
  /** Atomic text writes remain the original native endpoint, without exposing its registration. */
  const valueCommit = controllerRegistry.get(native)?.valueCommit
  /** A borrowed alias captures only this finite callback, retaining its exact original native owner. */
  const watchRecords = snapshotBackendEntityRecordWatcher(native)
  /** The host's borrowed view forwards exactly these admitted native methods without close access. */
  const access: IBackendEntityAccess = {
    store: view as IEntityKeyValueMethods,
    recordStore: () =>
      snapshotRecordStore(native) === undefined ? undefined : (view as IEntityRecordMethods),
    secondaryStore: () =>
      isSecondaryIndexRecordStore(native) ? (view as IEntitySecondaryMethods) : undefined,
    assertCurrent,
    ...(watchRecords === undefined
      ? {}
      : {
          watchRecords: (ctx?: IOperationContext) => {
            assertCurrent()
            return watchRecords(ctx)
          }
        }),
    ...(valueCommit === undefined
      ? {}
      : {
          valueCommit: (...args: Parameters<IBackendValueCommit>) => {
            assertCurrent()
            return valueCommit(...args)
          }
        }),
    assertScope: (scope: object) => {
      assertCurrent()
      return assertTransactionOwner(native, scope)
    }
  }
  /** This is the same original registry row as controller, envelope and query projection. */
  const row = controllerRegistry.get(view) ?? {}
  if (row.entity !== undefined)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  row.entity = access
  controllerRegistry.set(view, row)
  return () => {
    if (controllerRegistry.get(view) !== row || row.entity !== access) return
    delete row.entity
    if (
      row.controller === undefined &&
      row.envelopes === undefined &&
      row.valueCommit === undefined
    )
      controllerRegistry.delete(view)
  }
}

/** Read resource-free facts for the exact certified alias; never unwrap or return a native handle. */
export function getBackendEntityAccess(view: object): IBackendEntityAccess | undefined {
  const access = controllerRegistry.get(view)?.entity
  access?.assertCurrent()
  return access
}

/** One private exact-store registry; observation also supports admitted stores without a controller. */
const controllerRegistry = new WeakMap<object, IBackendRegistration>()

/** Monotonic fallback for unique same-realm event origins. */
let controllerOriginSequence = 0

/** Large commits preserve the original coarse-invalidation bound. */
const maxEventKeys = 128
/** All mutation leases for one physical controller share its one canonical lifecycle lane. */
const mutationLeaseKey = 'backend-mutation'

/** Read the canonical entity scope used by coarse record invalidations. */
function canonicalScopeOf(key: IStorageKey): string | undefined {
  return Array.isArray(key) &&
    key.length === 3 &&
    key[0] === REPOSITORY_KEY_PREFIX &&
    typeof key[1] === 'string' &&
    typeof key[2] === 'string'
    ? key[1]
    : undefined
}

/** Derive a scope only when every retained record key belongs to that same scope. */
function deriveScope(keys: readonly IStorageKey[] | undefined): string | undefined {
  if (keys === undefined || keys.length === 0) return undefined
  /** Every key must agree with the first canonical scope. */
  const first = canonicalScopeOf(keys[0]!)
  return first !== undefined && keys.every((key) => canonicalScopeOf(key) === first)
    ? first
    : undefined
}

/** The original channel and lifecycle owners remain private to one physical backend. */
class BackendChangeController implements IBackendChangeController {
  /** Native platform and configured options remain borrowed references in this captured boundary. */
  readonly snapshot: IBackendChangeSnapshot
  /** Same-realm origins retain the existing unique sequence fallback. */
  readonly origin: string
  /** Backend admission observes this original controller's closure. */
  readonly closingSignal: INativeAbortSignal
  /** The original options object supplies its finalizer with the correct receiver. */
  readonly #input: IBackendChangeControllerOptions
  /** Actual committed local publications alone advance this counter. */
  #sequence = 0
  /** Physical closure follows mutation drain and native finalization. */
  #disposed = false
  /** This signal closes new admissions without cancelling admitted mutation leases. */
  readonly #closing: ReturnType<typeof createAbortController>
  /** The canonical lifecycle registry owns all admitted mutation drain. */
  readonly #mutationLeases: ReturnType<typeof createStringLeaseRegistry>
  /** All cleanup callers receive the same original completion promise. */
  #disposePromise: Promise<void> | undefined
  /** Observer failures terminate at the existing diagnostic boundary. */
  readonly #reporter: ReturnType<typeof createStorageOperationReporter>
  /** The original event channel preserves queued reentrant delivery. */
  readonly #channel: ReturnType<typeof createEventChannel<IStorageChange>>

  /** Admit synchronous configuration before acquiring a channel or lifecycle resource. */
  constructor(input: IBackendChangeControllerOptions) {
    if (
      typeof input.backend !== 'string' ||
      (input.origin !== undefined && typeof input.origin !== 'string') ||
      (input.finalize !== undefined && typeof input.finalize !== 'function')
    )
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    this.#input = input
    this.snapshot = { backend: input.backend, platform: input.platform, options: input.options }
    this.origin = input.origin ?? `${input.backend}:${(controllerOriginSequence += 1).toString(36)}`
    this.#closing = createAbortController()
    this.closingSignal = this.#closing.signal
    this.#mutationLeases = createStringLeaseRegistry()
    this.#reporter = createStorageOperationReporter()
    this.#channel = createEventChannel<IStorageChange>({
      report: ({ error }) => reportCleanupError(this.#reporter, error),
      dispatchPolicy: EventDispatchPolicy.queued
    })
  }

  /** Reject only new work after logical or physical closure. */
  readonly assertLive = (): void => {
    if (this.#closing.signal.aborted || this.#disposed)
      throw new StorageContractError(StorageContractErrorCode.disposed, {
        backend: this.snapshot.backend
      })
  }

  /** Retain one actual mutation through the canonical lease registry. */
  readonly beginMutation = (): (() => void) => {
    this.assertLive()
    return this.#mutationLeases.retain(mutationLeaseKey)
  }

  /** Add local sequence/origin only after an actual backend commit. */
  readonly publish = (
    change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>
  ): IStorageChange | undefined => {
    if (this.#disposed) return
    this.#sequence += 1
    /** Oversized commits retain scope while omitting unbounded key lists. */
    const keys =
      change.keys !== undefined && change.keys.length > maxEventKeys ? undefined : change.keys
    /** Caller metadata is retained unchanged alongside this controller's actual commit facts. */
    const event: IStorageChange = {
      ...change,
      keys,
      scope: change.channel === 'record' ? deriveScope(change.keys) : undefined,
      sequence: this.#sequence,
      origin: this.origin
    }
    this.#emit(event)
    return event
  }

  /** Preserve transport sequence and origin without advancing local publication history. */
  readonly publishExternal = (change: IStorageChange): void => {
    if (this.#disposed) return
    /** Coarse external invalidations follow the original bounded event policy. */
    const keys =
      change.keys !== undefined && change.keys.length > maxEventKeys ? undefined : change.keys
    this.#emit({
      ...change,
      keys,
      scope: change.channel === 'record' ? deriveScope(keys) : undefined
    })
  }

  /** Event subscription retains the original event channel's listener lifetime. */
  readonly subscribe = (listener: (change: IStorageChange) => void): (() => void) =>
    this.#channel.subscribe((event) => listener(event.value))

  /** Drain accepted mutations before invoking the original native finalizer exactly once. */
  readonly dispose = (): Promise<void> => {
    if (this.#disposePromise !== undefined) return this.#disposePromise
    this.#mutationLeases.seal(mutationLeaseKey)
    this.#disposePromise = this.#mutationLeases.whenZero(mutationLeaseKey).then(async () => {
      try {
        await this.#input.finalize?.()
      } catch (cause) {
        if (isNativeErrorValue(cause) && IdentifyError.identityOf(cause) !== undefined) throw cause
        throw new StorageError(
          StorageErrorCode.storageHostDisposeFailed,
          { backend: this.snapshot.backend, cause },
          StorageErrorText.storageHostDisposeFailed
        )
      } finally {
        this.#disposed = true
        this.#channel.clear()
      }
    })
    /** Cache completion before closure observers can reenter disposal. */
    this.#closing.abort(
      new StorageContractError(StorageContractErrorCode.disposed, {
        backend: this.snapshot.backend
      })
    )
    return this.#disposePromise
  }

  /** Report observer failure without changing a committed native outcome. */
  #emit(event: IStorageChange): void {
    if (this.#disposed) return
    try {
      this.#channel.publish(event)
    } catch (cause) {
      reportCleanupError(this.#reporter, cause)
    }
  }
}

/** Construct one controller without exposing event-channel or lifecycle state. */
export const createBackendChangeController = (
  input: IBackendChangeControllerOptions
): IBackendChangeController => new BackendChangeController(input)

/** Register one exact store instance and reject accidental duplicate ownership. */
export const registerBackendChangeController = (
  store: Pick<IStorageBase, 'backend'>,
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
    if (row.envelopes === undefined && row.valueCommit === undefined && row.entity === undefined)
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
  store: object,
  factory: IBackendEntityBinding['envelope'],
  queryMethods?: IBackendEntityBinding['queryMethods']
): (() => void) => {
  /** A shared raw object may belong to more than one host; each original scope retains its binding. */
  const row = controllerRegistry.get(store) ?? {}
  const binding: IBackendEntityBinding = { envelope: factory, queryMethods }
  ;(row.envelopes ??= []).push(binding)
  controllerRegistry.set(store, row)
  return () => {
    if (controllerRegistry.get(store) !== row) return
    /** Remove only this registration; other live hosts still observe the shared original store. */
    const index = row.envelopes?.indexOf(binding) ?? -1
    if (index < 0) return
    row.envelopes!.splice(index, 1)
    if (row.envelopes!.length === 0) delete row.envelopes
    if (
      row.controller === undefined &&
      row.envelopes === undefined &&
      row.valueCommit === undefined &&
      row.entity === undefined
    )
      controllerRegistry.delete(store)
  }
}

/** Entity borrows original host observers without gaining construction authority or store wrappers. */
export const getBackendEnvelopeStages = (
  store: object,
  operation: Readonly<{ operation: string; targetVersion: number }>
): IStorageEnvelopeStages | undefined => {
  /** The ordinary single-host path returns its original bound observer directly. */
  const factories = controllerRegistry.get(store)?.envelopes
  if (factories === undefined) return undefined
  if (factories.length === 1) return factories[0]!.envelope(operation)
  /** Shared raw identity cannot identify a caller host, so all original active bindings observe it. */
  const stages = factories.map((binding) => binding.envelope(operation))
  return {
    beforeEnvelopeCheck: () => {
      for (const stage of stages) stage.beforeEnvelopeCheck()
    },
    afterEnvelopeCheck: (version) => {
      for (const stage of stages) stage.afterEnvelopeCheck(version)
    },
    onVersionRejected: (version, code) => {
      for (const stage of stages) stage.onVersionRejected(version, code)
    },
    afterMigrate: (version, mode, count, elapsed) => {
      for (const stage of stages) stage.afterMigrate(version, mode, count, elapsed)
    },
    observe: {
      beforeStep: (context) => {
        for (const stage of stages) stage.observe.beforeStep?.(context)
      },
      afterStep: (context) => {
        for (const stage of stages) stage.observe.afterStep?.(context)
      },
      report: (cause) => {
        for (const stage of stages) stage.observe.report?.(cause)
      }
    }
  }
}

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
    if (row.controller === undefined && row.envelopes === undefined && row.entity === undefined)
      controllerRegistry.delete(store)
  }
}

/** Entity borrows the captured native endpoint without exposing its registration authority. */
export const getBackendValueCommit = (store: object): IBackendValueCommit | undefined => {
  const row = controllerRegistry.get(store)
  return row?.valueCommit ?? row?.entity?.valueCommit
}

/** Read selected methods from the original storage cell without duplicating its Feature table. */
export const getBackendEntityQueryMethods = (store: object): object | undefined => {
  /** Shared raw stores have no implicit host router; distinct control-plane bindings are ambiguous. */
  let methods: object | undefined
  let selectedBinding = false
  for (const binding of controllerRegistry.get(store)?.envelopes ?? []) {
    const selected = binding.queryMethods?.()
    if (selectedBinding && methods !== selected)
      throw new StorageError(StorageErrorCode.invalidConfig)
    methods = selected
    selectedBinding = true
  }
  return methods
}
