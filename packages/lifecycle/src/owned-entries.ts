/** Minimal shape stored by an owner: release lookup is keyed by `resource`. */
export type IOwnedEntry = { readonly resource: unknown }

/** One registration; `entry` becomes `undefined` once released so the slot can be compacted. */
type ISlot<E> = { entry: E | undefined }

/** Compaction waits for at least this many tombstones so small scopes never rebuild the array. */
const minimumTombstones = 32

/**
 * Live owned resources in registration order with O(1) release lookup. Owners create one on their
 * first registration, so a scope that never owns anything allocates neither the array nor the
 * index.
 */
export class OwnedEntryList<E extends IOwnedEntry> {
  /** Insertion-ordered slots; a released slot keeps its position with `entry: undefined`. */
  #slots: ISlot<E>[] = []
  /** Single registrations avoid an array; repeated resources retain oldest-first release order. */
  #byResource = new Map<unknown, ISlot<E> | ISlot<E>[]>()
  /** Count of tombstoned slots still present in `#slots`; drives compaction. */
  #tombstones = 0

  /** Appends one entry at the end of registration order. */
  push(entry: E): void {
    /** New live slot shared between the insertion array and the per-resource index. */
    const slot: ISlot<E> = { entry }
    this.#slots.push(slot)
    /** Earlier live registrations of the same resource, if any. */
    const list = this.#byResource.get(entry.resource)
    if (list === undefined) this.#byResource.set(entry.resource, slot)
    else if (Array.isArray(list)) list.push(slot)
    else this.#byResource.set(entry.resource, [list, slot])
  }

  /**
   * Removes the earliest live entry registered for `resource` and returns it, or `undefined` when
   * no live entry exists. Matches the former `findIndex` + `splice` behavior for repeated owners.
   */
  release(resource: unknown): E | undefined {
    /** Live slot or slots registered for this resource. */
    const list = this.#byResource.get(resource)
    if (list === undefined) return undefined
    /** Arrays exist only for two or more live registrations of the same resource. */
    const slot = Array.isArray(list) ? list.shift()! : list
    if (Array.isArray(list)) {
      if (list.length === 1) this.#byResource.set(resource, list[0]!)
    } else this.#byResource.delete(resource)
    /** The released entry, returned to the owner for its own cleanup. */
    const entry = slot.entry
    slot.entry = undefined
    this.#tombstones++
    this.#compactIfSparse()
    return entry
  }

  /** Removes and returns every live entry in registration order, leaving the list empty. */
  drain(): E[] {
    /** Live entries in registration order. */
    const live: E[] = []
    for (const slot of this.#slots) if (slot.entry !== undefined) live.push(slot.entry)
    this.#slots = []
    this.#byResource.clear()
    this.#tombstones = 0
    return live
  }

  /** Drops tombstoned slots once they dominate the array; slot objects keep their identity. */
  #compactIfSparse(): void {
    if (this.#tombstones < minimumTombstones || this.#tombstones * 2 <= this.#slots.length) return
    this.#slots = this.#slots.filter((slot) => slot.entry !== undefined)
    this.#tombstones = 0
  }
}
