import type { IRuntime } from '@migaia/reactive'
import { persistUnit } from '../core/persist-unit.ts'
import type {
  ICodec,
  IMigrationStep,
  IMigrationReset,
  ISyncMigrationSteps
} from '@migaia/storage-contract'
import type {
  IPersistHandle,
  IPersistStorage,
  IPersistUnit,
  IPersistUnitOptions
} from '../core/types.ts'
import { snapshotPersistOptions } from '../core/options.ts'

/**
 * Supports the four `store-indexed` collections through snapshots and whole-state replacement.
 * Reading `snapshot()` establishes the dependencies observed by the adapter's Runtime effect.
 * Restoration delegates whole-state replacement to the collection; the collection owns its
 * validation and mutation guarantees rather than this structural contract adding rollback.
 */
export type IPersistableCollection<TState> = {
  /** Borrowed graph owner for the subscription effect and persistence status values. */
  readonly runtime: IRuntime
  /** Synchronously reads state and establishes the collection's reactive snapshot dependencies. */
  snapshot(): TState
  /** Restores a reconciled archive using the collection's own replacement semantics. */
  replace(state: TState): void
}

/** Whole-collection attachment options with optional shape-specific write projection and merge. */
export type IPersistCollectionOptions<TState> = Pick<
  IPersistUnitOptions<TState>,
  'debounceMs' | 'maxWaitMs' | 'scheduler' | 'codecStages' | 'transactionStages'
> & {
  /** Required archive key passed unchanged to storage. */
  key: string
  /** Borrowed text-capable storage with optional binary operations. */
  storage: IPersistStorage
  /** Complete envelope codec, default defaultJsonCodec, including Map/Set round trips. */
  codec?: ICodec
  /** Nonnegative safe archive version, default 0. */
  version?: number
  /** Contiguous upgrade steps, or an explicit reset of older archives. */
  migrations?: Readonly<Record<number, IMigrationStep>> | IMigrationReset
  /** Synchronous write projection, default identity; pair partial non-object shapes with merge. */
  partialize?: (state: TState) => Partial<TState>
  /**
   * Synchronous reconciliation, default attachment-baseline merge for plain objects and archive
   * replacement for arrays, Maps, Sets and other shapes. Return a complete replacement state.
   */
  merge?: (persisted: Partial<TState>, current: TState) => TState
}

function toPersistUnit<TState>(collection: IPersistableCollection<TState>): IPersistUnit<TState> {
  return {
    snapshot: () => collection.snapshot(),
    restore: (state) => collection.replace(state),
    subscribe: (onChange) => {
      let first = true
      /** The subscription owns the public effect handle while exposing the existing disposer API. */
      const effect = collection.runtime.effect(() => {
        // 读一次 snapshot() 建立追踪依赖；首次运行是 Effect 构造自带的同步执行，
        // 不是真正的"变化"，必须跳过，否则 hydrate 之前就会误触发一次写回。
        collection.snapshot()
        if (first) {
          first = false
          return
        }
        onChange()
      })
      return () => effect.dispose()
    }
  }
}

/**
 * Persists one collection through snapshot/replace, inferring its state type from that boundary.
 * Copies options once and owns an effect that skips its initial dependency-tracking run, then
 * requests writes on later changes. Returns the shared handle immediately; await ready for
 * restoration and flush for completed writes. Invalid configuration throws; asynchronous failures
 * remain on the handle. Disposal removes this effect without disposing collection, Runtime or
 * storage.
 */
export function persistCollection<
  TState,
  const TSteps extends Readonly<Record<number, IMigrationStep>> | IMigrationReset
>(
  collection: IPersistableCollection<TState>,
  options: Omit<IPersistCollectionOptions<TState>, 'migrations'> & {
    readonly migrations?: TSteps & ISyncMigrationSteps<NoInfer<TSteps>>
  }
): IPersistHandle
export function persistCollection<TState>(
  collection: IPersistableCollection<TState>,
  options: IPersistCollectionOptions<TState>
): IPersistHandle {
  const snapshot = snapshotPersistOptions(options)
  return persistUnit(toPersistUnit(collection), {
    key: snapshot.key,
    runtime: collection.runtime,
    storage: snapshot.storage,
    codec: snapshot.codec,
    version: snapshot.version,
    migrations: snapshot.migrations,
    codecStages: snapshot.codecStages,
    transactionStages: snapshot.transactionStages,
    partialize: snapshot.partialize,
    merge: snapshot.merge,
    debounceMs: snapshot.debounceMs,
    maxWaitMs: snapshot.maxWaitMs,
    scheduler: snapshot.scheduler
  })
}
