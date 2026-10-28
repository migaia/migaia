/**
 * Owns keyed topology storage and copy-on-write transaction overlays. Exposes node facts and
 * stores; ordering and graph policy remain with their owners.
 */
import type { ITopologyDependency } from './topology.js'

export type IStoredTopologyNode = Readonly<{
  readonly id: string
  readonly ordinal: number
  readonly level: number
  readonly dependencies: readonly ITopologyDependency[]
}>

/** The keyed-store subset the index uses, satisfied by a `Map` and by a transaction overlay. */
export type IKeyedStore<K, V> = {
  readonly size: number
  get(key: K): V | undefined
  has(key: K): boolean
  set(key: K, value: V): unknown
  delete(key: K): boolean
  keys(): IterableIterator<K>
  values(): IterableIterator<V>
}

/** Marks a key an overlay removed from its base store. */
const REMOVED: unique symbol = Symbol('topology-index.removed')

/**
 * Copy-on-write view over a base store: reads fall through to the base, writes stay in the overlay.
 * Opening it costs nothing and committing it costs the number of keys written, which keeps a
 * transaction proportional to the change instead of to the whole index.
 */
export class OverlayStore<K, V> implements IKeyedStore<K, V> {
  /** Store observed until this overlay is committed; never written by the overlay. */
  readonly #base: IKeyedStore<K, V>
  /** Keys written in this overlay: a replacement value or the removal marker. */
  readonly #own = new Map<K, V | typeof REMOVED>()
  /** Merged-view size, maintained on every write so `size` stays O(1). */
  #size: number

  /** Wraps `base` without copying it. */
  constructor(base: IKeyedStore<K, V>) {
    this.#base = base
    this.#size = base.size
  }

  /** Number of keys in the merged view. */
  get size(): number {
    return this.#size
  }

  /** Reads the overlay value, falling back to the base for untouched keys. */
  get(key: K): V | undefined {
    if (!this.#own.has(key)) return this.#base.get(key)
    /** Overlay removals remain distinguishable from a stored undefined payload. */
    const own = this.#own.get(key)
    return own === REMOVED ? undefined : own
  }

  /** Reports membership in the merged view. */
  has(key: K): boolean {
    if (this.#own.has(key)) return this.#own.get(key) !== REMOVED
    return this.#base.has(key)
  }

  /** Whether `key` was written by this overlay (its value is not shared with the base). */
  owns(key: K): boolean {
    return this.#own.has(key) && this.#own.get(key) !== REMOVED
  }

  /** Writes one value into the overlay. */
  set(key: K, value: V): this {
    if (!this.has(key)) this.#size += 1
    this.#own.set(key, value)
    return this
  }

  /** Removes one key from the merged view. */
  delete(key: K): boolean {
    if (!this.has(key)) return false
    this.#size -= 1
    this.#own.set(key, REMOVED)
    return true
  }

  /** Iterates merged keys: untouched base keys first, then keys the overlay added. */
  *keys(): IterableIterator<K> {
    for (const key of this.#base.keys()) if (this.has(key)) yield key
    for (const [key, value] of this.#own) if (value !== REMOVED && !this.#base.has(key)) yield key
  }

  /** Iterates merged values in `keys()` order. */
  *values(): IterableIterator<V> {
    for (const key of this.keys()) yield this.get(key)!
  }

  /** Applies each written key once in O(K); ordered bucket copies are published as complete values. */
  applyTo(target: IKeyedStore<K, V>): void {
    for (const [key, value] of this.#own)
      if (value === REMOVED) target.delete(key)
      else target.set(key, value)
  }
}
