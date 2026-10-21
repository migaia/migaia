/**
 * 定义化 optics：在 Definition 层做投影 / 聚焦 / 拆分。
 *
 * 这里产出纯 def token，由 AtomStore / useAtomDefinition 实例化；同一份蓝图可在多个 Provider / SSR 请求下各有一份状态，不依赖已删除的实例式
 * optics 构造器。
 */

import {
  derivedDef,
  writableDef,
  type IAtomDefinition,
  type IAtomUpdate,
  type IDerivedDefinition,
  type IWritableAtomDefinition,
  type IWritableDerivedDefinition
} from './definition.js'
import { createStoreKeyedError, StoreKeyedErrorCode } from '../errors.js'
import { StoreKeyedErrorText } from '../error-text.js'
import type { IAtomStore } from './store.js'
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
} from './optics-path.js'

/** Provides immutable `get` and `set` operations with the same shape as `IAtomOptic`. */
export type IDefOptic<Source, Focus> = {
  get(source: Source): Focus
  set(source: Source, focus: Focus): Source
}

/**
 * Provides a writable source for focus, optic, or split operations with standard `set(update)`
 * semantics.
 */
export type IStandardWritableDef<T> = IWritableAtomDefinition<T, readonly [IAtomUpdate<T>], void>

/**
 * Creates a read-only projection from any readable definition through `derivedDef`. `equals`
 * defaults to `Object.is`. Changes to other source fields do not notify downstream observers when
 * the projection is unchanged.
 */
export function selectDef<Source, Selected>(
  source: IAtomDefinition<Source>,
  select: (value: Source) => Selected,
  equals: (left: Selected, right: Selected) => boolean = Object.is
): IDerivedDefinition<Selected> {
  return derivedDef((get) => select(get(source)), undefined, equals)
}

/** Creates a writable projection through a custom lens. */
export function opticDef<Source, Focus>(
  source: IStandardWritableDef<Source>,
  optic: IDefOptic<Source, Focus>
): IWritableDerivedDefinition<Focus, readonly [IAtomUpdate<Focus>], void> {
  return writableDef(
    (get) => optic.get(get(source)),
    (get, set, update) => {
      const currentSource = get(source)
      const currentFocus = optic.get(currentSource)
      const nextFocus =
        typeof update === 'function' ? (update as (value: Focus) => Focus)(currentFocus) : update
      if (Object.is(nextFocus, currentFocus)) return
      set(source, optic.set(currentSource, nextFocus))
    }
  )
}

/**
 * Defines one field of a writable source, up to three keys deep. Reads subscribe only to that
 * field; writes produce a new source with the field replaced. Missing path segments throw.
 */
export function focusDef<Source, K1 extends keyof Source>(
  source: IStandardWritableDef<Source>,
  key1: K1
): IWritableDerivedDefinition<Source[K1], readonly [IAtomUpdate<Source[K1]>], void>
export function focusDef<Source, K1 extends keyof Source, K2 extends keyof Source[K1]>(
  source: IStandardWritableDef<Source>,
  key1: K1,
  key2: K2
): IWritableDerivedDefinition<Source[K1][K2], readonly [IAtomUpdate<Source[K1][K2]>], void>
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
): IWritableDerivedDefinition<Source[K1][K2][K3], readonly [IAtomUpdate<Source[K1][K2][K3]>], void>
export function focusDef<Source>(
  source: IStandardWritableDef<Source>,
  ...path: readonly PropertyKey[]
): IWritableDerivedDefinition<unknown, readonly [IAtomUpdate<unknown>], void> {
  if (path.length === 0) {
    throw createStoreKeyedError(StoreKeyedErrorCode.invalidOption, StoreKeyedErrorText.focusPath)
  }
  return opticDef(source, {
    get: (value) => readOpticPath(value, path, 'focusDef'),
    set: (value, focus) => writeOpticPath(value, path, focus, 'focusDef') as Source
  })
}

/** Writable definition of one list item produced by `splitDef(...).of(key)`. */
export type ISplitItemDef<T> = IWritableDerivedDefinition<T, readonly [IAtomUpdate<T>], void>

/**
 * Splits a list source into item definitions by key.
 *
 * `of(key)` returns a stable writable item definition that can be reused across stores. `items`
 * derives the current item definitions and preserves their identity during reordering. `insert` and
 * `remove` update the source list through `AtomStore`.
 */
export type ISplitDefinition<T, Key> = {
  readonly source: IStandardWritableDef<readonly T[]>
  readonly items: IDerivedDefinition<readonly ISplitItemDef<T>[]>
  of(key: Key): ISplitItemDef<T>
  insert(store: IAtomStore, item: T, index?: number): void
  remove(store: IAtomStore, key: Key): boolean
  /**
   * Removes cached definitions for keys that are no longer in the source list. This does not
   * release instances in `AtomStore`; use `store.release(def)` for that. Without pruning, a
   * continually changing key space causes the cache map to grow indefinitely.
   */
  prune(store: IAtomStore): number
}

/**
 * Splits a writable array definition into one writable definition per key, so each item is
 * subscribed to and written on its own. Keys must be unique; reading or writing a removed key
 * throws.
 */
export function splitDef<T, Key = number>(
  source: IStandardWritableDef<readonly T[]>,
  keyOf: (item: T, index: number) => Key = (_item, index) => index as unknown as Key
): ISplitDefinition<T, Key> {
  const cache = new KeyedSplitCache<Key, ISplitItemDef<T>>()

  const of = (key: Key): ISplitItemDef<T> =>
    cache.of(key, () =>
      writableDef<T, readonly [IAtomUpdate<T>], void>(
        (get) => {
          const items = get(source)
          return items[requireKeyIndex(items, keyOf, key, 'split def item was removed')]
        },
        (get, set, update) => {
          const items = get(source)
          const index = requireKeyIndex(items, keyOf, key, 'cannot write a removed split def item')
          const current = items[index]
          const next = typeof update === 'function' ? (update as (value: T) => T)(current) : update
          if (Object.is(next, current)) return
          set(source, replaceAtIndex(items, index, next))
        }
      )
    )

  const items = derivedDef(
    (get) => Object.freeze(computeUniqueKeys(get(source), keyOf, 'splitDef').map(of)),
    undefined,
    shallowArrayEquals
  )

  return {
    source,
    items,
    of,
    insert(store, item, index = Number.POSITIVE_INFINITY) {
      store.set(source, (previous) => spliceInsert(previous, item, index))
    },
    remove(store, key) {
      let removed = false
      store.set(source, (previous) => {
        const result = filterOutKey(previous, keyOf, key)
        removed = result.removed
        return result.next
      })
      return removed
    },
    prune(store) {
      const list = store.get(source)
      const active = new Set(list.map((item, index) => keyOf(item, index)))
      return cache.prune((key) => active.has(key))
    }
  }
}
