import type { IComputedValue, IDisposer, IRuntime } from '@migaia/reactive'
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
  /** Reads the current persistable state synchronously. */
  snapshot(): TState
  /** Restores state synchronously during hydration. */
  restore(state: TState): void
  /** Registers change notifications and returns an unsubscribe function. */
  subscribe(onChange: () => void): IDisposer
}

export type IPersistStatus =
  | typeof PersistState.loading
  | typeof PersistState.ready
  | typeof PersistState.error
  | typeof PersistState.disposed
export type IHydrationStatus =
  | typeof PersistState.loading
  | typeof PersistState.success
  | typeof PersistState.error
export type IWriteStatus =
  | typeof PersistState.idle
  | typeof PersistState.writing
  | typeof PersistState.error
  | typeof PersistState.disposed

export type IReadonlyPersistValue<T> = {
  readonly value: T
}

export type IPersistHandle = {
  status: IComputedValue<IPersistStatus>
  error: IComputedValue<unknown>
  hydrated: IComputedValue<boolean>
  hydrationStatus: IReadonlyPersistValue<IHydrationStatus>
  hydrationError: IReadonlyPersistValue<unknown>
  writeStatus: IReadonlyPersistValue<IWriteStatus>
  writeError: IReadonlyPersistValue<unknown>
  /** Resolves when hydration succeeds and rejects when hydration fails. */
  ready: Promise<void>
  /** Resolves after hydration, whether it succeeds or fails. */
  settled: Promise<void>
  /** Reads the archive again after failure. Only successful hydration reopens the write gate. */
  retryHydrate(): Promise<void>
  /**
   * Writes immediately and waits for all in-flight writes. Disposal during the wait ends it with
   * `AbortError`.
   */
  flush(): Promise<void>
  /** Queues archive removal. Disposal during the wait ends it with `AbortError`. */
  clear(): Promise<void>
  readonly disposed: boolean
  dispose(): void
}

export type IPersistUnitOptions<TState> = {
  key: string
  /**
   * Owns the status signals. Use the underlying store, collection, or `AtomStore` runtime to keep
   * them in one graph.
   */
  runtime: IRuntime
  storage: IPersistStorage
  /**
   * Encodes and decodes the complete `{ version, state }` envelope. The codec does not specialize
   * on the state type.
   */
  codec?: ICodec
  version?: number
  migrate?: (persisted: TState, fromVersion: number) => TState
  partialize?: (state: TState) => Partial<TState>
  merge?: (persisted: Partial<TState>, current: TState) => TState
  debounceMs?: number
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
  readonly getBytes?: IRecordStore['getBytes']
  readonly setBytes?: IRecordStore['setBytes']
}

/** Provides byte storage capabilities after the binary branch applies its internal guard. */
export type IPersistByteStorage = IPersistStorage &
  Required<Pick<IPersistStorage, 'getBytes' | 'setBytes'>>
