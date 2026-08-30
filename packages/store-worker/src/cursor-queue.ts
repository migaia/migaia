/** Minimum consumed prefix before an active queue compacts its backing array. */
const COMPACT_HEAD_THRESHOLD = 64

/** FIFO queue with amortized O(1) reads and bounded retention of consumed array slots. */
export class CursorQueue<T> {
  /** Backing storage containing consumed prefix slots followed by live values. */
  readonly #values: T[] = []
  /** Index of the next live value in `#values`. */
  #head = 0

  /** Number of values currently available to consumers. */
  get size(): number {
    return this.#values.length - this.#head
  }

  /** Appends one value at the tail. */
  push(value: T): void {
    this.#values.push(value)
  }

  /** Removes and returns the oldest value without shifting the remaining array on every read. */
  take(): T | undefined {
    if (this.#head >= this.#values.length) return undefined
    const value = this.#values[this.#head++]
    if (this.#head === this.#values.length) {
      this.#values.length = 0
      this.#head = 0
    } else if (this.#head >= COMPACT_HEAD_THRESHOLD && this.#head * 2 >= this.#values.length) {
      this.#values.splice(0, this.#head)
      this.#head = 0
    }
    return value
  }
}
