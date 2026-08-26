import type { IDisposer, IRuntime } from '@migaia/reactive'
import { persistUnit } from '../core/persist-unit.js'
import type { ICodec } from '@migaia/storage-web'
import type { IPersistHandle, IPersistStorage, IPersistUnit } from '../core/types.js'
import { snapshotPersistOptions } from '../core/options.js'

/**
 * `persist()` 实际用到的 store 能力面，只有 4 个成员。
 *
 * 故意在这里定义、不从 `@migaia/store-light` 借用它的 `IReactiveStore`：store-persist 是通用持久化层，
 * 依赖方向不该倒过来。`@migaia/store-light` 产出的 store 结构上完全满足这个接口，传进来不需要任何改动。
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

export type IPersistOptions = {
  key: string
  storage: IPersistStorage
  codec?: ICodec
  version?: number
  migrate?: (persisted: Record<string, unknown>, fromVersion: number) => Record<string, unknown>
  partialize?: (state: Record<string, unknown>) => Record<string, unknown>
  debounceMs?: number
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
    debounceMs: snapshot.debounceMs
  })
}
