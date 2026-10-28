/**
 * Owns one provider's consumer membership and registration order. Maintains dense ordered entries
 * on writes so direct reads need no ordering projection.
 */

/** One bucket-owned edge, indexed by identity and by its current dense array position. */
type IConsumerEntry = {
  /** Present consumer identity used by reverse traversals and direct dependent results. */
  readonly id: string
  /** Immutable registration position determines placement when an older consumer reconnects. */
  readonly ordinal: number
  /** Edge kind can change without changing the consumer's registration position. */
  required: boolean
  /** Current array slot lets deletion start without scanning for the identity. */
  position: number
}

/** Maintains one provider's ordered reverse edges and owns transaction bucket copies. */
export class TopologyConsumerBucket {
  /** Dense registration-order entries are shared only with this bucket's internal read view. */
  readonly #entries: IConsumerEntry[] = []
  /** Identity lookup avoids a scan for updates and locates a deletion's array position in O(1). */
  readonly #byId = new Map<string, IConsumerEntry>()

  /**
   * Creates an empty bucket in O(1), or copies a transaction's first-write bucket in O(deg). Every
   * copied entry and its position belong to the new bucket; base readers remain isolated.
   */
  constructor(source?: TopologyConsumerBucket) {
    if (!source) return
    for (const entry of source.#entries) {
      /** Independent mutable position and edge kind prevent transaction writes reaching the base. */
      const copy = { ...entry }
      this.#entries.push(copy)
      this.#byId.set(copy.id, copy)
    }
  }

  /** Returns membership count in O(1), allowing empty provider buckets to be pruned. */
  get size(): number {
    return this.#entries.length
  }

  /** Returns the existing ordered internal view in O(1), without allocating an iterator or array. */
  get entries(): readonly Readonly<IConsumerEntry>[] {
    return this.#entries
  }

  /**
   * Updates a known edge or appends a newest ordinal in O(1). An older reconnect shifts one suffix
   * in O(deg), retaining registration order without sorting.
   */
  set(id: string, required: boolean, ordinal: number): void {
    /** An existing identity changes only its edge kind; its ordinal and position remain stable. */
    const current = this.#byId.get(id)
    if (current) {
      current.required = required
      return
    }
    /** New ordinals begin at the append slot; older ordinals move backward only as needed. */
    const entry: IConsumerEntry = { id, required, ordinal, position: this.#entries.length }
    this.#byId.set(id, entry)
    this.#entries.push(entry)
    /** Each displaced entry moves once, so insertion remains O(deg) for the complete write. */
    let position = entry.position
    while (position > 0) {
      /** The immediately earlier ordinal either completes placement or shifts one slot right. */
      const previous = this.#entries[position - 1]!
      if (previous.ordinal <= ordinal) break
      this.#entries[position] = previous
      previous.position = position
      position -= 1
    }
    this.#entries[position] = entry
    entry.position = position
  }

  /**
   * Removes a consumer found by identity in O(1), then closes its dense-array gap in O(deg). Each
   * remaining suffix entry moves once and retains a matching identity index position.
   */
  delete(id: string): boolean {
    /** Captured position identifies the exact edge without a membership scan. */
    const entry = this.#byId.get(id)
    if (!entry) return false
    this.#byId.delete(id)
    for (let position = entry.position + 1; position < this.#entries.length; position += 1) {
      /** A single left move preserves the registration order of every surviving consumer. */
      const next = this.#entries[position]!
      this.#entries[position - 1] = next
      next.position = position - 1
    }
    this.#entries.pop()
    return true
  }

  /** Visits each stored consumer ID once in O(deg), preserving reverse-traversal registration order. */
  *keys(): IterableIterator<string> {
    for (const entry of this.#entries) yield entry.id
  }
}
