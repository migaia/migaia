import type { IRuntime } from '@migaia/reactive'
import { persistUnit } from '../core/persist-unit.js'
import type { ICodec } from '@migaia/storage-contract'
import type { IPersistHandle, IPersistStorage, IPersistUnit } from '../core/types.js'
import { snapshotPersistOptions } from '../core/options.js'

/**
 * Supports the four `store-indexed` collections through snapshots and whole-state replacement.
 * `snapshot()` tracks a structural signal, so `runtime.effect()` observes structural changes.
 * `replace(state)` atomically replaces the complete state. `ObservableMap` and `ObservableSet` add
 * the same replacement capability already available on `ObservableObject` and `ObservableArray`.
 */
export type IPersistableCollection<TState> = {
  readonly runtime: IRuntime
  snapshot(): TState
  replace(state: TState): void
}

export type IPersistCollectionOptions<TState> = {
  key: string
  storage: IPersistStorage
  codec?: ICodec
  version?: number
  migrate?: (persisted: TState, fromVersion: number) => TState
  partialize?: (state: TState) => Partial<TState>
  merge?: (persisted: Partial<TState>, current: TState) => TState
  debounceMs?: number
}

function toPersistUnit<TState>(collection: IPersistableCollection<TState>): IPersistUnit<TState> {
  return {
    snapshot: () => collection.snapshot(),
    restore: (state) => collection.replace(state),
    subscribe: (onChange) => {
      let first = true
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
      return effect
    }
  }
}

// Each collection provides its own `snapshot()` and `replace()` types and structurally satisfies `IPersistableCollection`.
// TypeScript infers the state type from the collection instead of requiring overloads for each collection.
// This avoids overload and implementation signature mismatches.
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
    migrate: snapshot.migrate,
    partialize: snapshot.partialize,
    merge: snapshot.merge,
    debounceMs: snapshot.debounceMs
  })
}
