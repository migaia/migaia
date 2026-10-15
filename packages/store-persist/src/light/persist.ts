import type { IDisposer, IRuntime } from '@migaia/reactive'
import { persistUnit } from '../core/persist-unit.js'
import type { ICodec } from '@migaia/storage-contract'
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
  readonly $runtime: IRuntime
  $plain(): Record<string, unknown>
  $subscribe(fn: () => void, options?: { readonly fireImmediately?: boolean }): IDisposer
  $hydrate(
    partial: Record<string, unknown>,
    options?: {
      readonly unknown?: 'ignore' | 'report' | 'strict'
      readonly onUnknown?: (key: string) => void
    }
  ): void
}

export type IPersistOptions = Pick<
  IPersistUnitOptions<Record<string, unknown>>,
  'debounceMs' | 'maxWaitMs' | 'scheduler'
> & {
  key: string
  storage: IPersistStorage
  codec?: ICodec
  version?: number
  migrate?: (persisted: Record<string, unknown>, fromVersion: number) => Record<string, unknown>
  partialize?: (state: Record<string, unknown>) => Record<string, unknown>
}

function toPersistUnit(store: IPersistableStore): IPersistUnit<Record<string, unknown>> {
  return {
    snapshot: () => store.$plain(),
    restore: (state) => store.$hydrate(state),
    subscribe: (onChange) => store.$subscribe(onChange, { fireImmediately: false })
  }
}

export function persist(store: IPersistableStore, options: IPersistOptions): IPersistHandle {
  const snapshot = snapshotPersistOptions(options)
  return persistUnit(toPersistUnit(store), {
    key: snapshot.key,
    runtime: store.$runtime,
    storage: snapshot.storage,
    codec: snapshot.codec,
    version: snapshot.version,
    migrate: snapshot.migrate,
    partialize: snapshot.partialize,
    debounceMs: snapshot.debounceMs,
    maxWaitMs: snapshot.maxWaitMs,
    scheduler: snapshot.scheduler
  })
}
