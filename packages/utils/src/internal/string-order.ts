/** One captured key retains its original string and a fixed-width, order-preserving digit sequence. */
type IOrderedString = {
  readonly value: string
  readonly digits: Uint16Array
}

/** A pending radix partition owns one contiguous range and its next unread digit. */
type IStringPartition = { readonly start: number; readonly end: number; readonly depth: number }

/** Zero sorts a completed key before every continuation; actual byte digits occupy 1 through 256. */
const END_DIGIT = 0
/** A byte has 256 values, plus the end marker; this compile-time alphabet never grows with input. */
const DIGIT_COUNT = 257

/** Encode UTF-16 units or Unicode code points without changing their lexicographic order. */
function encodeStringKey(value: string, codePoints: boolean): Uint16Array {
  /** UTF-16 uses two bytes; a Unicode code point fits in three bytes. */
  const width = codePoints ? 3 : 2
  /** UTF-16 length is an upper bound on the number of Unicode code points. */
  const digits = new Uint16Array(value.length * width)
  /** Only code-point encoding can leave unused capacity after a surrogate pair. */
  let written = 0
  for (let index = 0; index < value.length;) {
    /** Unpaired surrogates keep their own numeric value, matching JavaScript string iteration. */
    const unit = codePoints ? value.codePointAt(index)! : value.charCodeAt(index)
    if (codePoints) digits[written++] = (unit >>> 16) + 1
    digits[written++] = ((unit >>> 8) & 255) + 1
    digits[written++] = (unit & 255) + 1
    index += codePoints && unit > 65535 ? 2 : 1
  }
  return written === digits.length ? digits : digits.subarray(0, written)
}

/** Stable MSD radix ordering visits each encoded digit and each partition's fixed alphabet once. */
class StringKeyOrder {
  /** Captured strings are rearranged locally; the caller's input array is never mutated. */
  #values: IOrderedString[]
  /** One reusable buffer supports stable partitioning without copying prefixes per member. */
  #buffer: IOrderedString[]
  /** Explicit partitions replace recursive closures and bound call-stack use independently of keys. */
  #pending: IStringPartition[]

  /** Snapshot every string once and choose the canonical character order required by the caller. */
  constructor(values: readonly string[], codePoints: boolean) {
    this.#values = values.map((value) => ({ value, digits: encodeStringKey(value, codePoints) }))
    this.#buffer = this.#values.slice()
    this.#pending = [{ start: 0, end: values.length, depth: 0 }]
  }

  /** Finish every disjoint partition, preserving duplicate-key input order. */
  run(): string[] {
    /** Each pending range is consumed exactly once unless its common prefix is skipped in place. */
    let partition: IStringPartition | undefined
    while ((partition = this.#pending.pop()) !== undefined) {
      if (partition.end - partition.start > 1) this.#partition(partition)
    }
    return this.#values.map((entry) => entry.value)
  }

  /** Split one range by its first differing digit and retain only nonterminal, nontrivial children. */
  #partition(partition: IStringPartition): void {
    /** Common prefixes consume input digits without allocating a bucket table at each character. */
    let depth = partition.depth
    while (true) {
      /** Every valid encoded byte is positive, so zero unambiguously denotes the end of a key. */
      const first = this.#values[partition.start].digits[depth] ?? END_DIGIT
      /** A common digit advances the whole range until it ends or actually branches. */
      let common = true
      for (let index = partition.start + 1; index < partition.end; index++) {
        if ((this.#values[index].digits[depth] ?? END_DIGIT) !== first) {
          common = false
          break
        }
      }
      if (!common) break
      if (first === END_DIGIT) return
      depth++
    }
    /** Bucket sizes belong to the fixed 257-symbol alphabet declared above. */
    const counts = new Uint32Array(DIGIT_COUNT)
    for (let index = partition.start; index < partition.end; index++)
      counts[this.#values[index].digits[depth] ?? END_DIGIT]++
    /** Prefix positions are computed once, rather than scanning earlier members for every write. */
    const starts = new Uint32Array(DIGIT_COUNT)
    /** The next bucket starts immediately after the preceding bucket. */
    let next = partition.start
    // DIGIT_COUNT is the compile-time byte alphabet plus one end marker, never an input-size loop.
    for (let digit = END_DIGIT; digit < DIGIT_COUNT; digit++) {
      starts[digit] = next
      next += counts[digit]
    }
    /** Moving cursors leave the immutable bucket starts available for child partitions. */
    const cursors = starts.slice()
    for (let index = partition.start; index < partition.end; index++) {
      /** Capture the original member before any destination in the shared buffer is overwritten. */
      const entry = this.#values[index]
      this.#buffer[cursors[entry.digits[depth] ?? END_DIGIT]++] = entry
    }
    for (let index = partition.start; index < partition.end; index++)
      this.#values[index] = this.#buffer[index]
    // Only the fixed byte alphabet is enumerated. Every split increases the number of nonempty ranges.
    for (let digit = END_DIGIT + 1; digit < DIGIT_COUNT; digit++) {
      if (counts[digit] > 1)
        this.#pending.push({
          start: starts[digit],
          end: starts[digit] + counts[digit],
          depth: depth + 1
        })
    }
  }
}

/**
 * Return a stable UTF-16 lexicographic ordering without mutating the input. Work and memory are
 * O(total UTF-16 units + key count): each key digit is consumed once, and each branching partition
 * has a fixed 257-symbol alphabet. This is the canonical key-order owner for wire/hash consumers.
 */
export function orderStringKeys(values: readonly string[]): string[] {
  return new StringKeyOrder(values, false).run()
}

/** Preserve ErrorChain's Unicode code-point ordering through the same linear radix implementation. */
export function orderCodePointKeys(values: readonly string[]): string[] {
  return new StringKeyOrder(values, true).run()
}
