/**
 * 定义化 optics：在 Definition 层做投影 / 聚焦 / 拆分。
 *
 * 实例层已有 selectAtom / focusAtom / splitAtom（吃活的 atom 对象）。 这里产出的是纯 def token，由 AtomStore /
 * useAtomDefinition 实例化—— 同一份蓝图可在多个 Provider / SSR 请求下各有一份状态。
 */

import {
  derivedDef,
  writableDef,
  type IAtomDefinition,
  type IAtomUpdate,
  type IDerivedDefinition,
  type IWritableAtomDefinition,
  type IWritableDerivedDefinition
} from './definition.js';
import { createStoreKeyedError, StoreKeyedErrorCode } from '../errors.js';
import { StoreKeyedErrorText } from '../error-text.js';
import type { IAtomStore } from './store.js';
import {
  readOpticPath,
  writeOpticPath,
  requireKeyIndex,
  shallowArrayEquals,
  computeUniqueKeys,
  spliceInsert,
  filterOutKey,
  replaceAtIndex,
  KeyedSplitCache
} from './optics-path.js';

/** 与实例层 IAtomOptic 同形：不可变 get/set。 */
export type IDefOptic<Source, Focus> = {
  get(source: Source): Focus;
  set(source: Source, focus: Focus): Source;
};

/** 可被 focus/optic/split 当「源」的可写定义（标准 set(update) 语义）。 */
export type IStandardWritableDef<T> = IWritableAtomDefinition<T, readonly [IAtomUpdate<T>], void>;

/** 只读投影。源任意可读 def；结果是 derivedDef。 equals 默认 Object.is——源对象其它字段变了、投影值不变则不通知下游。 */
export function selectDef<Source, Selected>(
  source: IAtomDefinition<Source>,
  select: (value: Source) => Selected,
  equals: (left: Selected, right: Selected) => boolean = Object.is
): IDerivedDefinition<Selected> {
  return derivedDef((get) => select(get(source)), undefined, equals);
}

/** 自定义 lens 的可写投影。 */
export function opticDef<Source, Focus>(
  source: IStandardWritableDef<Source>,
  optic: IDefOptic<Source, Focus>
): IWritableDerivedDefinition<Focus, readonly [IAtomUpdate<Focus>], void> {
  return writableDef(
    (get) => optic.get(get(source)),
    (get, set, update) => {
      const currentSource = get(source);
      const currentFocus = optic.get(currentSource);
      const nextFocus =
        typeof update === 'function' ? (update as (value: Focus) => Focus)(currentFocus) : update;
      if (Object.is(nextFocus, currentFocus)) return;
      set(source, optic.set(currentSource, nextFocus));
    }
  );
}

export function focusDef<Source, K1 extends keyof Source>(
  source: IStandardWritableDef<Source>,
  key1: K1
): IWritableDerivedDefinition<Source[K1], readonly [IAtomUpdate<Source[K1]>], void>;
export function focusDef<Source, K1 extends keyof Source, K2 extends keyof Source[K1]>(
  source: IStandardWritableDef<Source>,
  key1: K1,
  key2: K2
): IWritableDerivedDefinition<Source[K1][K2], readonly [IAtomUpdate<Source[K1][K2]>], void>;
export function focusDef<
  Source,
  K1 extends keyof Source,
  K2 extends keyof Source[K1],
  K3 extends keyof Source[K1][K2]
>(
  source: IStandardWritableDef<Source>,
  key1: K1,
  key2: K2,
  key3: K3
): IWritableDerivedDefinition<Source[K1][K2][K3], readonly [IAtomUpdate<Source[K1][K2][K3]>], void>;
export function focusDef<Source>(
  source: IStandardWritableDef<Source>,
  ...path: readonly PropertyKey[]
): IWritableDerivedDefinition<unknown, readonly [IAtomUpdate<unknown>], void> {
  if (path.length === 0) {
    throw createStoreKeyedError(StoreKeyedErrorCode.invalidOption, StoreKeyedErrorText.focusPath);
  }
  return opticDef(source, {
    get: (value) => readOpticPath(value, path, 'focusDef'),
    set: (value, focus) => writeOpticPath(value, path, focus, 'focusDef') as Source
  });
}

export type ISplitItemDef<T> = IWritableDerivedDefinition<T, readonly [IAtomUpdate<T>], void>;

/**
 * 列表源上的按 key 拆分。
 *
 * - `of(key)`：该 key 的可写 item def（token 稳定，可跨 store 复用）
 * - `items`：当前列表对应的 item def 数组（derived；重排保 identity）
 * - `insert` / `remove`：经 AtomStore 改源列表
 */
export type ISplitDefinition<T, Key> = {
  readonly source: IStandardWritableDef<readonly T[]>;
  readonly items: IDerivedDefinition<readonly ISplitItemDef<T>[]>;
  of(key: Key): ISplitItemDef<T>;
  insert(store: IAtomStore, item: T, index?: number): void;
  remove(store: IAtomStore, key: Key): boolean;
  /**
   * 丢掉已不在源列表中的 key 的 def 缓存。 不 release AtomStore 里已建实例——那是 store.release(def) 的职责。 不 prune 时，长期滚动的
   * key 空间会让 cache Map 只增不减。
   */
  prune(store: IAtomStore): number;
};

export function splitDef<T, Key = number>(
  source: IStandardWritableDef<readonly T[]>,
  keyOf: (item: T, index: number) => Key = (_item, index) => index as unknown as Key
): ISplitDefinition<T, Key> {
  const cache = new KeyedSplitCache<Key, ISplitItemDef<T>>();

  const of = (key: Key): ISplitItemDef<T> =>
    cache.of(key, () =>
      writableDef<T, readonly [IAtomUpdate<T>], void>(
        (get) => {
          const items = get(source);
          return items[requireKeyIndex(items, keyOf, key, 'split def item was removed')];
        },
        (get, set, update) => {
          const items = get(source);
          const index = requireKeyIndex(items, keyOf, key, 'cannot write a removed split def item');
          const current = items[index];
          const next = typeof update === 'function' ? (update as (value: T) => T)(current) : update;
          if (Object.is(next, current)) return;
          set(source, replaceAtIndex(items, index, next));
        }
      )
    );

  const items = derivedDef(
    (get) => Object.freeze(computeUniqueKeys(get(source), keyOf, 'splitDef').map(of)),
    undefined,
    shallowArrayEquals
  );

  return {
    source,
    items,
    of,
    insert(store, item, index = Number.POSITIVE_INFINITY) {
      store.set(source, (previous) => spliceInsert(previous, item, index));
    },
    remove(store, key) {
      let removed = false;
      store.set(source, (previous) => {
        const result = filterOutKey(previous, keyOf, key);
        removed = result.removed;
        return result.next;
      });
      return removed;
    },
    prune(store) {
      const list = store.get(source);
      const active = new Set(list.map((item, index) => keyOf(item, index)));
      return cache.prune((key) => active.has(key));
    }
  };
}
