/**
 * Owns the planner's immutable selected-membership result. Exposes the read-only Set protocol;
 * selection and topology traversal stay planner-owned.
 */

/** Owns immutable selected membership while preserving the original frozen facade shape. */
class DependencyReadonlySet<T> implements ReadonlySet<T> {
  /** Captured members stay private so no public operation can mutate membership. */
  readonly #lookup: Set<T>
  /** Bound membership query remains callable after method extraction. */
  declare readonly has: (value: T) => boolean
  /** Own accessor preserves the original facade's enumerable key order. */
  declare readonly size: number
  /** Bound entry iterator retains canonical selected-member order. */
  declare readonly entries: () => SetIterator<[T, T]>
  /** Bound key iterator retains canonical selected-member order. */
  declare readonly keys: () => SetIterator<T>
  /** Bound value iterator retains canonical selected-member order. */
  declare readonly values: () => SetIterator<T>
  /** Standard callback protocol receives this frozen read-only set. */
  declare readonly forEach: (
    callback: (value: T, value2: T, set: ReadonlySet<T>) => void,
    thisArg?: unknown
  ) => void
  /** Bound default iterator preserves extracted iteration behavior. */
  declare readonly [Symbol.iterator]: () => SetIterator<T>

  /** Captures members and exposes the existing own-property protocol in its original order. */
  constructor(values: Iterable<T>) {
    this.#lookup = new Set(values)
    Object.assign(this, { has: (value: T) => this.#lookup.has(value) })
    Object.defineProperty(this, 'size', {
      enumerable: true,
      configurable: true,
      get: () => this.#lookup.size
    })
    Object.assign(this, {
      entries: () => this.#lookup.entries(),
      keys: () => this.#lookup.keys(),
      values: () => this.#lookup.values(),
      forEach: (
        callback: (value: T, value2: T, set: ReadonlySet<T>) => void,
        thisArg?: unknown
      ) => {
        for (const value of this.#lookup) Reflect.apply(callback, thisArg, [value, value, this])
      },
      [Symbol.iterator]: () => this.#lookup[Symbol.iterator]()
    })
  }
}

/** Publishes the planner's selected membership as a frozen read-only Set. */
export function createDependencyReadonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
  return Object.freeze(new DependencyReadonlySet(values))
}
