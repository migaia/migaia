import type { IReactiveSignal } from '@migaia/reactive'
import type { IObservable } from '@migaia/reactive/extension'
import { KeyedCellRegistry, scheduleLazyCellRelease } from './keyed-cell-registry.ts'

/**
 * Shared getOrCreate / speculative-lease / tombstone lifecycle for a keyed map of lazily
 * materialized reactive cells.
 *
 * ObservableObject/Array/Map/Set each hand-rolled an identical `#cell(key)` + `#pruneCell(key)`
 * pair — differing only in the key type and how the signal's initial value was computed. This is
 * the one implementation all four now share. A collection stays responsible for its own data
 * structure (`#values`); the pool owns only cell materialization and reclamation, via
 * `own`/`release` callbacks the collection supplies (its existing ownership bookkeeping, e.g.
 * `ObservableCollectionBase#nodes`).
 */
export class ReactiveCellPool<K, V> {
  /** Materialized nodes share the collection's ownership and subscriber lifecycle. */
  #cells = new KeyedCellRegistry<K, IReactiveSignal<V> & IObservable>()
  /** Registers each materialized node with its collection's disposal bookkeeping. */
  readonly #own: (node: IReactiveSignal<V> & IObservable) => IReactiveSignal<V> & IObservable
  /** Removes collection ownership only after a node becomes dormant. */
  readonly #release: (node: IReactiveSignal<unknown> & IObservable) => boolean

  /** Uses the collection's existing ownership callbacks for every pooled node. */
  constructor(
    own: (node: IReactiveSignal<V> & IObservable) => IReactiveSignal<V> & IObservable,
    release: (node: IReactiveSignal<unknown> & IObservable) => boolean
  ) {
    this.#own = own
    this.#release = release
  }

  /** Reads an existing node without materializing a speculative lease. */
  get(key: K): (IReactiveSignal<V> & IObservable) | undefined {
    return this.#cells.get(key)
  }

  /** Observer count of a materialized cell; 0 for a key with no cell yet. */
  observerCount(key: K): number {
    return this.#cells.get(key)?.subs.size ?? 0
  }

  /**
   * Materialize a cell on first access. Every new cell is a speculative lease: released once its
   * last observer disconnects, and — the tombstone case, a cell nobody ever subscribed to —
   * reclaimed at the end of the current microtask so a stray peek/read doesn't pin it forever.
   */
  getOrCreate(
    key: K,
    create: () => IReactiveSignal<V> & IObservable
  ): IReactiveSignal<V> & IObservable {
    const existing = this.#cells.get(key)
    if (existing) return existing
    const cell = this.#own(create())
    this.#cells.set(key, cell)
    cell.addObservedHooks({
      onUnobserved: () => {
        this.releaseIfDormant(key, cell)
      }
    })
    scheduleLazyCellRelease(cell.runtime, this.#cells, key, cell, () => this.#release(cell))
    return cell
  }

  /** Drop `key`'s cell now if it is exactly `cell` and has no remaining observers. */
  releaseIfDormant(key: K, cell: IReactiveSignal<unknown> & IObservable): boolean {
    if (this.#cells.get(key) !== cell) return false
    if (!this.#release(cell)) return false
    this.#cells.delete(key)
    return true
  }

  /**
   * A value left the collection (delete/set-absent). If the cell is dormant it is reclaimed
   * immediately; otherwise it stays live — still-observed cells report the value's absence rather
   * than disappearing out from under a subscriber.
   */
  tombstone(key: K): boolean {
    const cell = this.#cells.get(key)
    if (!cell) return false
    return this.releaseIfDormant(key, cell)
  }

  keys(): IterableIterator<K> {
    return this.#cells.keys()
  }

  /** Iterates materialized nodes without changing their ownership. */
  entries(): IterableIterator<[K, IReactiveSignal<V> & IObservable]> {
    return this.#cells.entries()
  }

  /** Exposes the same materialized-node iteration to collection consumers. */
  [Symbol.iterator](): IterableIterator<[K, IReactiveSignal<V> & IObservable]> {
    return this.#cells.entries()
  }

  get size(): number {
    return this.#cells.size
  }

  /** Tombstone every cell whose key `isLive` reports gone. Returns the count removed. */
  pruneStale(isLive: (key: K) => boolean): number {
    let removed = 0
    for (const key of Array.from(this.#cells.keys())) {
      if (!isLive(key) && this.tombstone(key)) removed++
    }
    return removed
  }

  /**
   * Terminal dispose: forgets every cell reference. Does not itself call `.dispose()` on the
   * signals — that is the collection's own ownership set's job (the same `own`/`release` callbacks
   * this pool was built with), so a cell is disposed exactly once regardless of whether it came
   * from this pool or another owned node.
   */
  dispose(): void {
    this.#cells.clear()
  }
}
