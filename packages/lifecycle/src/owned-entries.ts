/** Minimum entry shape the list indexes: the owned resource used as the `release()` lookup key. */
export type IOwnedEntry = {
  readonly resource: unknown
}

/**
 * Registration-ordered storage shared by `LifecycleScope` and `SyncLifecycleScope`. Gives O(1)
 * `release(resource)` through a per-resource index plus a tombstoned insertion array, while
 * `drain()` still returns live entries in registration order for the scopes' LIFO teardown.
 */
export type IOwnedEntryList<E extends IOwnedEntry> = {
  /** Appends one entry at the end of registration order. */
  push(entry: E): void
  /**
   * Removes the earliest live entry registered for `resource` and returns it, or `undefined` when
   * no live entry exists. Matches the former `findIndex` + `splice` behavior for repeated owners.
   */
  release(resource: unknown): E | undefined
  /** Removes and returns every live entry in registration order, leaving the list empty. */
  drain(): E[]
}

/** Slot wrapper so a released entry can be tombstoned in place without shifting later indexes. */
type ISlot<E> = {
  entry: E | undefined
}

/**
 * Creates an empty owned-entry list. Tombstones are compacted once they make up more than half of a
 * non-trivial insertion array, so long-lived scopes with own/release churn stay bounded and each
 * operation remains amortized O(1).
 */
export function createOwnedEntryList<E extends IOwnedEntry>(): IOwnedEntryList<E> {
  /** Insertion-ordered slots; a released slot keeps its position with `entry: undefined`. */
  let slots: ISlot<E>[] = []
  /** Live slots per resource, oldest first, so `release()` finds its target without scanning. */
  const byResource = new Map<unknown, ISlot<E>[]>()
  /** Count of tombstoned slots still present in `slots`; drives compaction. */
  let tombstones = 0

  /** Drops tombstoned slots once they dominate the array; slot objects keep their identity. */
  const compactIfSparse = (): void => {
    if (tombstones < 32 || tombstones * 2 <= slots.length) return
    slots = slots.filter((slot) => slot.entry !== undefined)
    tombstones = 0
  }

  return {
    push(entry) {
      /** New live slot shared between the insertion array and the per-resource index. */
      const slot: ISlot<E> = { entry }
      slots.push(slot)
      const list = byResource.get(entry.resource)
      if (list === undefined) byResource.set(entry.resource, [slot])
      else list.push(slot)
    },
    release(resource) {
      const list = byResource.get(resource)
      if (list === undefined) return undefined
      const slot = list.shift()!
      if (list.length === 0) byResource.delete(resource)
      const entry = slot.entry
      slot.entry = undefined
      tombstones++
      compactIfSparse()
      return entry
    },
    drain() {
      /** Live entries in registration order. */
      const live: E[] = []
      for (const slot of slots) if (slot.entry !== undefined) live.push(slot.entry)
      slots = []
      byResource.clear()
      tombstones = 0
      return live
    }
  }
}
