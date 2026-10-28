/**
 * Orders already-admitted finite numeric disposal keys in O(n) total work. Fixed-width IEEE-754
 * keys permit stable radix buckets without comparison sorting or narrowing the public number API.
 */
import type { IReleaseDescriptor } from './types.ts'

/** An admitted descriptor contains plain snapshotted data, never caller-owned accessors. */
type IOrderedItem = { readonly descriptor: IReleaseDescriptor }

/** JavaScript numbers use exactly eight IEEE-754 bytes, independent of collection size. */
const keyBytes = 8
/** Each byte has exactly 256 values; bucket scans have a compile-time fixed upper bound. */
const bucketCount = 256
/** Bit 31 distinguishes negative values in the high IEEE-754 word. */
const signBit = 0x80000000

/** Precomputes descending unsigned keys once; signed zero is normalized so ties stay stable. */
function captureOrderKeys(items: readonly IOrderedItem[]): Uint32Array {
  /** Two words per item retain a fixed-width key without allocating one buffer per entry. */
  const keys = new Uint32Array(items.length * 2)
  /** One reusable buffer decodes every admitted number, with explicit endian order. */
  const view = new DataView(new ArrayBuffer(keyBytes))
  for (let index = 0; index < items.length; index++) {
    /** Admission has already supplied zero for an omitted ordering key. */
    const order = items[index]!.descriptor.order ?? 0
    view.setFloat64(0, order === 0 ? 0 : order)
    /** The high word carries the sign and exponent. */
    const high = view.getUint32(0)
    /** The low word carries the remaining significand bits. */
    const low = view.getUint32(4)
    // Negative raw bits already increase in descending numeric order. Positive bits need their
    // magnitude inverted, with the sign lane preceding every negative value.
    keys[index * 2] = order < 0 ? low : ~low
    keys[index * 2 + 1] = order < 0 ? high : ~high ^ signBit
  }
  return keys
}

/** Reads one least-significant-first byte from a precomputed two-word key. */
function keyBucket(keys: Uint32Array, index: number, pass: number): number {
  return (keys[index * 2 + (pass >>> 2)]! >>> ((pass & 3) * 8)) & 0xff
}

/**
 * Stably orders finite number keys, highest first. Eight passes and 256 buckets are fixed by the
 * JavaScript number representation, so the whole batch is O(n), including ties and fractional
 * keys.
 */
export function orderDisposeItems<T extends IOrderedItem>(items: T[]): void {
  if (items.length < 2) return
  /** Key extraction is once per item and cannot invoke a user accessor after admission. */
  const keys = captureOrderKeys(items)
  /** Current stable index order begins as the caller's original sequence. */
  let current = new Uint32Array(items.length)
  /** Reused destination avoids rebuilding a collection for every item or bucket. */
  let next = new Uint32Array(items.length)
  /** Counts become insertion offsets after one fixed-size prefix scan. */
  const counts = new Uint32Array(bucketCount)
  for (let index = 0; index < current.length; index++) current[index] = index
  // Exactly eight passes: keyBytes is fixed by IEEE-754, not supplied by the caller.
  for (let pass = 0; pass < keyBytes; pass++) {
    counts.fill(0)
    for (const index of current) counts[keyBucket(keys, index, pass)]!++
    /** The next bucket begins after every preceding bucket's final item. */
    let offset = 0
    // Exactly 256 buckets: bucketCount is the compile-time byte domain.
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      /** Preserve the bucket's size before replacing its count with its start offset. */
      const count = counts[bucket]!
      counts[bucket] = offset
      offset += count
    }
    for (const index of current) {
      /** Original order within a bucket is maintained on every pass. */
      const bucket = keyBucket(keys, index, pass)
      next[counts[bucket]!] = index
      counts[bucket]!++
    }
    /** Swap two reused buffers; no input-sized copying occurs between passes. */
    const previous = current
    current = next
    next = previous
  }
  /** One snapshot supports the final permutation without overwriting an unread item. */
  const original = items.slice()
  for (let index = 0; index < current.length; index++) items[index] = original[current[index]!]!
}
