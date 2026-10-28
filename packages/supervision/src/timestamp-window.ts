/** Owns an ordered rolling window; consumers read live counts without moving each surviving suffix. */
export class TimestampWindow {
  /** Ordered timestamps; expired entries remain inaccessible until amortized compaction. */
  #timestamps: number[] = []
  /** First live timestamp, advanced once for each expired entry. */
  #head = 0

  /** Returns only timestamps still owned by the current window. */
  get length(): number {
    return this.#timestamps.length - this.#head
  }

  /** Returns the earliest live grant for the next rate-expiry deadline. */
  get first(): number | undefined {
    return this.#timestamps[this.#head]
  }

  /** Adds one observed grant or failure in chronological order. */
  append(timestamp: number): void {
    this.#timestamps.push(timestamp)
  }

  /** Expires the inclusive old boundary in O(expired), with amortized O(1) storage reclamation. */
  trim(now: number, windowMs: number): void {
    while (this.#head < this.#timestamps.length && now - this.#timestamps[this.#head]! >= windowMs)
      this.#head++
    if (this.#head === this.#timestamps.length) this.clear()
    else if (this.#head * 2 >= this.#timestamps.length) {
      // Each copied live entry is paid for by an expired entry; a batch remains linear overall.
      this.#timestamps.copyWithin(0, this.#head)
      this.#timestamps.length -= this.#head
      this.#head = 0
    }
  }

  /** Forgets the previous restart epoch without retaining its timestamps. */
  clear(): void {
    this.#timestamps.length = 0
    this.#head = 0
  }
}
