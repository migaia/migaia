import type { IScheduler } from '@migaia/utils/scheduler'
import type { IReactiveComputed, IDisposer, IRuntime } from '@migaia/reactive'
import type { ICodec, IKeyValueStore, IRecordStore } from '@migaia/storage-contract'
import { PersistState } from '../state-constants.js'

/**
 * Defines the minimal persistence boundary for synchronous snapshots, restoration, and change
 * subscriptions.
 *
 * `persist()` for `store-light`, `persistCollection()` for `store-indexed`, and each keyed unit
 * from `persistKeyed()` implement this contract. All use the same `persistUnit()` engine.
 */
export type IPersistUnit<TState> = {
  /** Reads current state synchronously, including once at attachment for the hydration baseline. */
  snapshot(): TState
  /** Restores reconciled state synchronously; the unit owns validation and any partial effects. */
  restore(state: TState): void
  /** Registers change notifications; the persistence handle owns the returned unsubscribe only. */
  subscribe(onChange: () => void): IDisposer
}

/** Combined lifecycle view: loading, ready, hydration/write error, or terminal disposal. */
export type IPersistStatus =
  | typeof PersistState.loading
  | typeof PersistState.ready
  | typeof PersistState.error
  | typeof PersistState.disposed
/** Latest hydration attempt's phase; disposal does not add a separate hydration phase. */
export type IHydrationStatus =
  | typeof PersistState.loading
  | typeof PersistState.success
  | typeof PersistState.error
/** Write/removal phase, independent of hydration; disposal takes precedence over late completion. */
export type IWriteStatus =
  | typeof PersistState.idle
  | typeof PersistState.writing
  | typeof PersistState.error
  | typeof PersistState.disposed

/** Read-only access to a Runtime signal without exposing its writable member in this contract. */
export type IReadonlyPersistValue<T> = {
  /** Current value; read inside a reactive observer to establish the underlying dependency. */
  readonly value: T
}

/**
 * Controls one archive and exposes hydration and write outcomes separately. The handle owns its
 * subscription, debounce timer and operation controllers, not the unit, storage or Runtime.
 */
export type IPersistHandle = {
  /** Disposed first, then loading/error, otherwise ready; ready also permits an in-flight write. */
  status: IReactiveComputed<IPersistStatus>
  /** Latest hydration/write error, combining both in an AggregateError when both are present. */
  error: IReactiveComputed<unknown>
  /** Whether the latest hydration attempt succeeded; disposal does not reset this result. */
  hydrated: IReactiveComputed<boolean>
  /** Loading/success/error for hydration; a retry starts a new loading phase. */
  hydrationStatus: IReadonlyPersistValue<IHydrationStatus>
  /** Hydration failure retained until another attempt starts; undefined initially and on success. */
  hydrationError: IReadonlyPersistValue<unknown>
  /** Idle/writing/error/disposed for serialized writes and removals. */
  writeStatus: IReadonlyPersistValue<IWriteStatus>
  /** Latest write failure, cleared by successful active writes; final disposal writes may update it. */
  writeError: IReadonlyPersistValue<unknown>
  /** Initial hydration attempt only; rejects on failure/cancellation and is not replaced by retry. */
  ready: Promise<void>
  /** Always resolves after the initial ready attempt settles, including failure or cancellation. */
  settled: Promise<void>
  /**
   * Starts another read when hydration has failed, without starting duplicate recovery reads. Await
   * the invocation that starts recovery before resuming explicit writes; concurrent calls need not
   * share its wait. The original ready/settled promises retain their initial results.
   */
  retryHydrate(): Promise<void>
  /**
   * Cancels debounce, waits for initial hydration and an observed in-flight write, then requests a
   * current snapshot write. Hydration/write failures reject; disposal is AbortError cancellation.
   * Completion depends on the adapter settling even when it ignores cancellation.
   */
  flush(): Promise<void>
  /**
   * Cancels debounce and queues removal of the codec's archive channel after initial hydration and
   * earlier writes. Does not reset live state or disable future writes; hydration/removal failures
   * reject, and disposal rejects with `AbortError`.
   */
  clear(): Promise<void>
  /** Terminal marker set synchronously by dispose, including while adapter work is still pending. */
  readonly disposed: boolean
  /**
   * Idempotently stops scheduling and aborts active operations without awaiting them. A pending
   * debounce or an admitted, unfinished write snapshots one final unawaited write; inspect
   * writeError for failure. Unsubscribe failures can throw after the handle is already terminal;
   * borrowed resources remain owned by their caller.
   */
  dispose(): void
  /**
   * Stops synchronously like dispose, then waits for admitted writes/removals and any final
   * snapshot write to settle, including adapters that ignore abort. Final-write failures remain on
   * writeError; existing flush/clear promises retain their original outcomes. A synchronous cleanup
   * failure rejects after the write chain settles. Does not wait for borrowed adapter reads or
   * dispose the borrowed store/runtime.
   */
  disposeAsync(): Promise<void>
}

/**
 * Configuration for one borrowed unit and archive; synchronous transform callbacks must not return
 * thenables.
 */
export type IPersistUnitOptions<TState> = {
  /** Required archive identity passed unchanged to storage; any string is accepted. */
  key: string
  /**
   * Owns the status signals. Use the underlying store, collection, or `AtomStore` runtime to keep
   * them in one graph.
   */
  runtime: IRuntime
  /** Borrowed text-capable adapter; binary routing additionally uses its byte capabilities/methods. */
  storage: IPersistStorage
  /**
   * Encodes and decodes the complete `{ version, state }` envelope. The codec does not specialize
   * on the state type. Defaults to defaultJsonCodec; structured output is unsupported for writes.
   */
  codec?: ICodec
  /** Archive schema version, default 0; must be a nonnegative safe integer. */
  version?: number
  /**
   * Synchronously transforms a different archived version; absence makes a version mismatch fail
   * hydration.
   */
  migrate?: (persisted: TState, fromVersion: number) => TState
  /** Synchronously selects state for each write, default identity; does not change in-memory state. */
  partialize?: (state: TState) => Partial<TState>
  /**
   * Synchronously reconciles an archive with current state. Default plain-object merging preserves
   * fields changed since the attachment snapshot; other shapes use archived replacement. Supply a
   * shape-specific merge when storing only part of an array, Map, Set or custom state.
   */
  merge?: (persisted: Partial<TState>, current: TState) => TState
  /** Quiet interval before enqueueing a write, default 0; finite range 0 through 2147483647 ms. */
  debounceMs?: number
  /**
   * Optional maximum from a window's first post-hydration change; same finite range as debounceMs.
   * Omitted means no maximum; zero schedules a zero-delay task when debounce is enabled. Does not
   * bound queue or adapter latency, and has no timer effect when debounceMs is zero.
   */
  maxWaitMs?: number
  /** Monotonic clock and cancellable timer owner; defaults to the canonical system scheduler. */
  scheduler?: IScheduler
}

/**
 * Projects persistence capabilities from canonical `storage-contract` types with `Pick`, without
 * duplicating method signatures. It is not re-exported as a package entry contract. Text-only
 * adapters need `capabilities`, `get`, `set`, `remove`, and `keys`. They do not need `backend`,
 * `has`, `clearValues`, `clearAll`, or `dispose`. Optional byte operations come from
 * `IRecordStore`.
 */
export type IPersistStorage = Pick<
  IKeyValueStore,
  'capabilities' | 'get' | 'set' | 'remove' | 'keys'
> & {
  /** Optional byte read paired with setBytes when capabilities.binary enables the binary route. */
  readonly getBytes?: IRecordStore['getBytes']
  /** Optional byte write paired with getBytes; text-only storage need not implement either method. */
  readonly setBytes?: IRecordStore['setBytes']
  /** Binary archive clearing uses the canonical per-key byte deletion operation. */
  readonly removeBytes?: IRecordStore['removeBytes']
}

/** Provides byte read/write capabilities after the binary branch applies its internal guard. */
export type IPersistByteStorage = IPersistStorage &
  Required<Pick<IPersistStorage, 'getBytes' | 'setBytes'>>
