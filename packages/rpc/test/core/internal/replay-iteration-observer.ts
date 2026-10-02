import { vi } from 'vitest'

/**
 * Counts only retained fixture keys while preserving the native Map iterator's receiver and values.
 * The spy is scoped to one synchronous assertion and always restored; production ledgers receive no
 * public statistics or writable inspection surface.
 */
export function countReplayEntryVisits(prefix: string, action: () => void): number {
  /** Canonical native iterator is retained before the temporary fixture observation. */
  const iterate = Map.prototype[Symbol.iterator]
  /** Counts entries actually yielded, including the first live entry used to stop a purge. */
  let visits = 0
  /** Each iterator remains a native object; only its fixture-local next call is observed. */
  const observation = vi
    .spyOn(Map.prototype, Symbol.iterator)
    .mockImplementation(function (this: Map<unknown, unknown>) {
      /** Reflect.apply preserves the native Map receiver brand without a mutable receiver helper. */
      const iterator = Reflect.apply(iterate, this, []) as MapIterator<[unknown, unknown]>
      /** Native next requires this exact iterator as its receiver. */
      const next = iterator.next
      /** Observation returns the same native yielded entries and completion result. */
      iterator.next = (...args) => {
        /** Retain the original iteration result instead of rebuilding ledger values. */
        const result = Reflect.apply(next, iterator, args)
        if (
          !result.done &&
          typeof result.value[0] === 'string' &&
          result.value[0].startsWith(prefix)
        )
          visits++
        return result
      }
      return iterator
    })
  try {
    action()
    return visits
  } finally {
    observation.mockRestore()
  }
}
