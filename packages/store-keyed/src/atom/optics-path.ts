/** Shared immutable path operations for definition optics and public custom optics. */
import {
  createStoreKeyedError,
  createStoreKeyedTypeError,
  createStoreKeyedAggregateError,
  STORE_KEYED_SOURCE,
  StoreKeyedErrorCode
} from '../errors.ts'
import { StoreKeyedErrorText } from '../error-text.ts'

import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'

/**
 * Identifies this pure optic boundary without replacing a native error or another package's
 * identity.
 */
function identifyOpticAccessFailure(error: unknown): Error {
  if (isNativeErrorValue(error)) {
    try {
      /** Own descriptors avoid invoking application metadata accessors while classifying a failure. */
      const source = Object.getOwnPropertyDescriptor(error, 'source')
      /** Existing complete identities continue to name their actual package owner. */
      const code = Object.getOwnPropertyDescriptor(error, 'code')
      if (typeof source?.value === 'string' && typeof code?.value === 'string') return error
      if (!source && !code && Object.isExtensible(error))
        return attachErrorIdentity(error, {
          source: STORE_KEYED_SOURCE,
          code: StoreKeyedErrorCode.opticAccessFailed
        })
    } catch (metadataError) {
      return createStoreKeyedAggregateError(
        StoreKeyedErrorCode.opticAccessFailed,
        [error, metadataError],
        StoreKeyedErrorText.opticAccessFailed
      )
    }
  }
  return createStoreKeyedError(
    StoreKeyedErrorCode.opticAccessFailed,
    StoreKeyedErrorText.opticAccessFailed,
    { cause: error }
  )
}

/** Map and Set use SameValueZero: signed zeros share a key and NaN equals itself. */
function keysEqual<Key>(left: Key, right: Key): boolean {
  return left === right || Object.is(left, right)
}

/** Reads `path` from `value`; throws `TypeError` naming `label` when a segment is missing. */
export function readOpticPath(
  value: unknown,
  path: readonly PropertyKey[],
  label: string
): unknown {
  try {
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
  } catch (error) {
    throw identifyOpticAccessFailure(error)
  }
}

/**
 * Returns a copy of `value` with `path` set to `next`, copying each level and never mutating the
 * original; throws `TypeError` naming `label` when a segment cannot be written.
 */
export function writeOpticPath(
  value: unknown,
  path: readonly PropertyKey[],
  next: unknown,
  label: string
): unknown {
  try {
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
  } catch (error) {
    throw identifyOpticAccessFailure(error)
  }
}

/** Finds a public split key using the same SameValueZero relation as its Map cache and Set keys. */
export function findKeyIndex<T, Key>(
  items: readonly T[],
  keyOf: (item: T, index: number) => Key,
  key: Key
): number {
  for (let index = 0; index < items.length; index++) {
    if (keysEqual(keyOf(items[index], index), key)) return index
  }
  return -1
}

/** True when both arrays have the same length and `Object.is`-equal items. */
export function shallowArrayEquals<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  )
}

/** Rejects duplicate SameValueZero keys before split definitions create or reuse item tokens. */
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

/** Returns a new frozen array with `item` inserted at `index`, clamped to the array bounds. */
export function spliceInsert<T>(list: readonly T[], item: T, index: number): readonly T[] {
  const next = [...list]
  const target = Math.max(0, Math.min(next.length, index))
  next.splice(target, 0, item)
  return Object.freeze(next)
}

/**
 * Removes every item whose key matches by SameValueZero; returns the original array when nothing
 * was removed.
 */
export function filterOutKey<T, Key>(
  list: readonly T[],
  keyOf: (item: T, index: number) => Key,
  key: Key
): { readonly removed: boolean; readonly next: readonly T[] } {
  let removed = false
  const next = list.filter((item, index) => {
    const keep = !keysEqual(keyOf(item, index), key)
    removed ||= !keep
    return keep
  })
  return removed ? { removed, next: Object.freeze(next) } : { removed, next: list }
}

/** Returns a new frozen array with the item at `index` replaced; the index is not bounds-checked. */
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
