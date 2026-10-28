/**
 * Owns the bounded integer frontier for incremental topology-level propagation. Exposes
 * minimum-level node selection; it has no asynchronous or resource lifecycle role.
 */

/** One binary digit bucket, with a FIFO only at the complete integer key. */
type ILevelBucket = {
  readonly parent?: ILevelBucket
  readonly right: boolean
  zero?: ILevelBucket
  one?: ILevelBucket
  values?: string[]
  cursor: number
}

/** Selects original dependency levels in O(54) steps without comparison sorting. */
export class TopologyLevelQueue {
  /** Root of the fixed-width digit tree, discarded with this propagation operation. */
  readonly #root: ILevelBucket = { right: false, cursor: 0 }
  /** Number of queued IDs; empty checks do not traverse the digit tree. */
  #size = 0

  /** Reports whether any propagation node remains queued. */
  get size(): number {
    return this.#size
  }

  /** Appends one admitted ID to its original-level bucket in constant bounded work. */
  push(id: string, level: number): void {
    /** Current prefix gains one binary digit on each bounded step. */
    let bucket = this.#root
    /** JavaScript integer increments saturate at 2^53, covered by 54 binary digits. */
    let factor = 2 ** 53
    // Exactly 54 binary digits cover every reachable nonnegative topology level.
    for (let digit = 0; digit < 54; digit += 1) {
      /** Integer powers of two preserve the complete nonnegative key exactly. */
      const right = Math.floor(level / factor) % 2 !== 0
      /** Existing prefix is shared by every queued node with the same higher digits. */
      let next = right ? bucket.one : bucket.zero
      if (!next) {
        next = { parent: bucket, right, cursor: 0 }
        if (right) bucket.one = next
        else bucket.zero = next
      }
      bucket = next
      factor /= 2
    }
    ;(bucket.values ??= []).push(id)
    this.#size += 1
  }

  /** Removes the first ID at the lowest original level, pruning exhausted digit prefixes. */
  take(): string | undefined {
    if (this.#size === 0) return undefined
    /** Prefer each zero child to select the numerically lowest populated complete key. */
    let bucket = this.#root
    // Every path contains exactly the 54 binary digits used by push().
    for (let digit = 0; digit < 54; digit += 1) bucket = bucket.zero ?? bucket.one!
    /** Same-level nodes retain their admission order without array shifting. */
    const id = bucket.values![bucket.cursor]!
    bucket.cursor += 1
    this.#size -= 1
    if (bucket.cursor < bucket.values!.length) return id
    while (bucket.parent) {
      /** Empty prefixes can be removed until another queued key shares their parent. */
      const parent = bucket.parent
      if (bucket.right) parent.one = undefined
      else parent.zero = undefined
      if (parent.zero || parent.one) break
      bucket = parent
    }
    return id
  }
}
