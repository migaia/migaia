/** Shared immutable path operations for instance and definition optics. */
import { createStoreKeyedError, createStoreKeyedTypeError, StoreKeyedErrorCode } from '../errors.js'
import { StoreKeyedErrorText } from '../error-text.js'

export function readOpticPath(
  value: unknown,
  path: readonly PropertyKey[],
  label: string
): unknown {
  let current = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') {
      throw createStoreKeyedTypeError(
        StoreKeyedErrorCode.invalidOption,
        StoreKeyedErrorText.opticRead(label, key)
      )
    }
    current = Reflect.get(current, key)
  }
  return current
}

export function writeOpticPath(
  value: unknown,
  path: readonly PropertyKey[],
  next: unknown,
  label: string
): unknown {
  const [key, ...rest] = path
  if (value === null || typeof value !== 'object') {
    throw createStoreKeyedTypeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.opticWrite(label, key)
    )
  }
  const clone: Record<PropertyKey, unknown> | unknown[] = Array.isArray(value)
    ? [...value]
    : { ...value }
  const childSource = Reflect.get(value, key)
  if (rest.length > 0 && (childSource === null || typeof childSource !== 'object')) {
    throw createStoreKeyedTypeError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.opticWrite(label, rest[0])
    )
  }
  const child = rest.length === 0 ? next : writeOpticPath(childSource, rest, next, label)
  if (key === '__proto__') {
    Object.defineProperty(clone, key, {
      value: child,
      enumerable: true,
      writable: true,
      configurable: true
    })
  } else {
    Reflect.set(clone, key, child)
  }
  return clone
}

/**
 * Shared keyed-split primitives. Instance (`SplitAtom`) and definition (`splitDef`) split kernels
 * both need "which index does this key currently point at" and "did the visible key list actually
 * change" — identical logic that had drifted into two copy-pasted implementations.
 */
export function findKeyIndex<T, Key>(
  items: readonly T[],
  keyOf: (item: T, index: number) => Key,
  key: Key
): number {
  for (let index = 0; index < items.length; index++) {
    if (Object.is(keyOf(items[index], index), key)) return index
  }
  return -1
}

export function shallowArrayEquals<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  )
}

/**
 * KeyedSplitKernel — the rest of what `SplitAtom` (instance) and `splitDef` (definition) both need
 * on top of `findKeyIndex`: computing the unique key list, resolving "this key must still exist"
 * reads/writes, and the insert/remove list transforms. Same logic, two copy-pasted implementations
 * before this; one implementation now, with each caller still owning its own item construction and
 * disposal policy (an atom needs `.dispose()`, a def token does not).
 */
export function computeUniqueKeys<T, Key>(
  items: readonly T[],
  keyOf: (item: T, index: number) => Key,
  label: string
): readonly Key[] {
  const seen = new Set<Key>()
  const keys = items.map((item, index) => {
    const key = keyOf(item, index)
    if (seen.has(key)) {
      throw createStoreKeyedError(
        StoreKeyedErrorCode.invalidOption,
        StoreKeyedErrorText.opticUnique(label)
      )
    }
    seen.add(key)
    return key
  })
  return Object.freeze(keys)
}

/** `findKeyIndex`, but throws instead of returning -1 for a key that must still be present. */
export function requireKeyIndex<T, Key>(
  items: readonly T[],
  keyOf: (item: T, index: number) => Key,
  key: Key,
  label: string
): number {
  const index = findKeyIndex(items, keyOf, key)
  if (index < 0)
    throw createStoreKeyedError(
      StoreKeyedErrorCode.invalidOption,
      StoreKeyedErrorText.opticMissing(label)
    )
  return index
}

export function spliceInsert<T>(list: readonly T[], item: T, index: number): readonly T[] {
  const next = [...list]
  const target = Math.max(0, Math.min(next.length, index))
  next.splice(target, 0, item)
  return Object.freeze(next)
}

export function filterOutKey<T, Key>(
  list: readonly T[],
  keyOf: (item: T, index: number) => Key,
  key: Key
): { readonly removed: boolean; readonly next: readonly T[] } {
  let removed = false
  const next = list.filter((item, index) => {
    const keep = !Object.is(keyOf(item, index), key)
    removed ||= !keep
    return keep
  })
  return removed ? { removed, next: Object.freeze(next) } : { removed, next: list }
}

export function replaceAtIndex<T>(list: readonly T[], index: number, value: T): readonly T[] {
  const next = [...list]
  next[index] = value
  return Object.freeze(next)
}

/** Shared keyed get-or-create cache backing both split kernels' `of(key)`. */
export class KeyedSplitCache<Key, Item> {
  #cache = new Map<Key, Item>()

  get(key: Key): Item | undefined {
    return this.#cache.get(key)
  }

  of(key: Key, create: () => Item): Item {
    const existing = this.#cache.get(key)
    if (existing) return existing
    const item = create()
    this.#cache.set(key, item)
    return item
  }

  /**
   * Evict cached keys `isLive` no longer reports; `shouldEvict` gates per-item (e.g. "not still
   * observed"); `onEvict` runs right before deletion for callers that must dispose the evicted
   * item.
   */
  prune(
    isLive: (key: Key) => boolean,
    shouldEvict: (item: Item) => boolean = () => true,
    onEvict?: (item: Item) => void
  ): number {
    let removed = 0
    for (const [key, item] of Array.from(this.#cache)) {
      if (!isLive(key) && shouldEvict(item)) {
        onEvict?.(item)
        this.#cache.delete(key)
        removed++
      }
    }
    return removed
  }

  get size(): number {
    return this.#cache.size
  }

  keys(): IterableIterator<Key> {
    return this.#cache.keys()
  }

  values(): IterableIterator<Item> {
    return this.#cache.values()
  }

  clear(): void {
    this.#cache.clear()
  }
}
