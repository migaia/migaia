import type { IRuntime } from '@migaia/reactive';
import { persistUnit } from '../core/persist-unit.js';
import type { ICodec } from '@migaia/storage-web';
import type { IPersistHandle, IPersistStorage, IPersistUnit } from '../core/types.js';
import { snapshotPersistOptions } from '../core/options.js';

/**
 * `persistCollection()` 支持的四种 store-indexed 集合。全部都有 `snapshot()`（tracked 读， 内部读了一个结构性 Signal，包进
 * `runtime.effect()` 就能感知任何结构变化）与 `replace(state)`（原子整体替换——`ObservableMap`/`ObservableSet`
 * 的这个方法是本轮跟这份 SDD 一起补的，之前只有 `ObservableObject`/`ObservableArray` 有）。
 */
export type IPersistableCollection<TState> = {
  readonly runtime: IRuntime;
  snapshot(): TState;
  replace(state: TState): void;
};

export type IPersistCollectionOptions<TState> = {
  key: string;
  storage: IPersistStorage;
  codec?: ICodec;
  version?: number;
  migrate?: (persisted: TState, fromVersion: number) => TState;
  partialize?: (state: TState) => Partial<TState>;
  merge?: (persisted: Partial<TState>, current: TState) => TState;
  debounceMs?: number;
};

function toPersistUnit<TState>(collection: IPersistableCollection<TState>): IPersistUnit<TState> {
  return {
    snapshot: () => collection.snapshot(),
    restore: (state) => collection.replace(state),
    subscribe: (onChange) => {
      let first = true;
      const effect = collection.runtime.effect(() => {
        // 读一次 snapshot() 建立追踪依赖；首次运行是 Effect 构造自带的同步执行，
        // 不是真正的"变化"，必须跳过，否则 hydrate 之前就会误触发一次写回。
        collection.snapshot();
        if (first) {
          first = false;
          return;
        }
        onChange();
      });
      return effect;
    }
  };
}

// 不用重载——四种集合各自的 snapshot()/replace() 具体类型不同，但都结构性满足
// IPersistableCollection<TState>，直接让 TS 从传入的 collection 参数推导 TState，
// 比为每种集合单独写一条重载签名更简单，也不会撞上"重载签名跟实现签名不兼容"这类噪音。
export function persistCollection<TState>(
  collection: IPersistableCollection<TState>,
  options: IPersistCollectionOptions<TState>
): IPersistHandle {
  const snapshot = snapshotPersistOptions(options);
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
  });
}
