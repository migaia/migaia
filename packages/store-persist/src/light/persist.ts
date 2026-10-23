import type { IDisposer, IRuntime } from '@migaia/reactive'
import { persistUnit } from '../core/persist-unit.js'
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
} from '../core/types.js'
import { snapshotPersistOptions } from '../core/options.js'

/**
 * Defines the four store capabilities used by `persist()`.
 *
 * The generic persistence layer owns this boundary instead of depending on `store-light`'s
 * `IReactiveStore`. Stores from `@migaia/store-light` satisfy it structurally without adaptation.
 */
export type IPersistableStore = {
  /** Borrowed graph owner for persistence status values and the Store's own notifications. */
  readonly $runtime: IRuntime
  /** Reads persistable signal-backed fields; the Store determines which fields are included. */
  $plain(): Record<string, unknown>
  /** Returns a disposer; the adapter passes fireImmediately false to avoid an attachment write. */
  $subscribe(fn: () => void, options?: { readonly fireImmediately?: boolean }): IDisposer
  /**
   * Restores known fields synchronously. Persistence supplies no options; the Store owns unknown
   * key handling, validation and errors rather than providing a transaction rollback here.
   */
  $hydrate(
    partial: Record<string, unknown>,
    options?: {
      readonly unknown?: 'ignore' | 'report' | 'strict'
      readonly onUnknown?: (key: string) => void
    }
  ): void
}

/** Store attachment options; Runtime and restoration merge come from the Store adapter. */
export type IPersistOptions = Pick<
  IPersistUnitOptions<Record<string, unknown>>,
  'debounceMs' | 'maxWaitMs' | 'scheduler' | 'codecStages'
> & {
  /** Required storage key, passed unchanged; empty strings are not rejected by this adapter. */
  key: string
  /** Borrowed storage adapter satisfying the core text/optional-byte projection. */
  storage: IPersistStorage
  /** Complete envelope codec, default defaultJsonCodec with Map/Set support. */
  codec?: ICodec
  /** Nonnegative safe archive version, default 0. */
  version?: number
  /** Contiguous upgrade steps, or an explicit reset of older archives. */
  migrations?: Readonly<Record<number, IMigrationStep>> | IMigrationReset
  /**
   * Synchronous write projection, default identity; omitted fields remain governed by Store
   * hydration.
   */
  partialize?: (state: Record<string, unknown>) => Record<string, unknown>
}

function toPersistUnit(store: IPersistableStore): IPersistUnit<Record<string, unknown>> {
  return {
    snapshot: () => store.$plain(),
    restore: (state) => store.$hydrate(state),
    subscribe: (onChange) => store.$subscribe(onChange, { fireImmediately: false })
  }
}

/**
 * Attaches automatic envelope hydration and writes to one existing Store. Copies supplied options
 * once, reuses the Store Runtime, reads through $plain and restores through $hydrate. Returns the
 * core handle before asynchronous hydration completes; await ready, then flush when persistence
 * must finish. Admission failures throw synchronously; hydration/write failures appear on the
 * handle. Disposing the attachment leaves the Store and storage caller-owned.
 */
export function persist<
  const TSteps extends Readonly<Record<number, IMigrationStep>> | IMigrationReset
>(
  store: IPersistableStore,
  options: Omit<IPersistOptions, 'migrations'> & {
    readonly migrations?: TSteps & ISyncMigrationSteps<NoInfer<TSteps>>
  }
): IPersistHandle
export function persist(store: IPersistableStore, options: IPersistOptions): IPersistHandle {
  const snapshot = snapshotPersistOptions(options)
  return persistUnit(toPersistUnit(store), {
    key: snapshot.key,
    runtime: store.$runtime,
    storage: snapshot.storage,
    codec: snapshot.codec,
    version: snapshot.version,
    migrations: snapshot.migrations,
    codecStages: snapshot.codecStages,
    partialize: snapshot.partialize,
    debounceMs: snapshot.debounceMs,
    maxWaitMs: snapshot.maxWaitMs,
    scheduler: snapshot.scheduler
  })
}
