/** Cache owns canonical request ordering after serialize has detached and validated the value. */
import type { ICodecValue } from '@migaia/serialize/codec'

/**
 * Native comparison sorting is limited to at most 32 keys, a compile-time bound. This avoids radix
 * workspace allocation for ordinary small requests; each key enters one such final range at most
 * once, so repeated string comparisons have a constant bound independent of input size.
 */
const nativeKeySortLimit = 32

/** A UTF-16 code unit has exactly two bytes, and each counting pass has exactly 256 buckets. */
const codeUnitByteBuckets = 256

/** A range owns one unprocessed suffix position; already ordered prefixes are never revisited. */
type IKeyOrderRange = { readonly start: number; readonly end: number; readonly depth: number }

/** MSD string ordering reuses one workspace and an explicit stack instead of recursive closures. */
class CacheKeyRadixOrder {
  /** Low-byte counts are reused across branching ranges rather than allocated per prefix. */
  readonly #lowCounts = new Uint32Array(codeUnitByteBuckets)
  /** High-byte counts select the more significant stable distribution for the current code unit. */
  readonly #highCounts = new Uint32Array(codeUnitByteBuckets)
  /** One cursor table serves both stable byte passes after their counts are captured. */
  readonly #positions = new Uint32Array(codeUnitByteBuckets)
  /** Temporary key references belong to this sort and are cleared before it returns. */
  readonly #scratch: string[] = []
  /** Pending disjoint suffix ranges contain positions only, with no captured request values. */
  readonly #pending: IKeyOrderRange[] = []

  /** Order unique Object.keys strings by UTF-16 code units in O(total key characters + keys). */
  sort(keys: string[]): void {
    this.#scratch.length = keys.length
    this.#pending.push({ start: 0, end: keys.length, depth: 0 })
    try {
      while (this.#pending.length > 0) {
        /** LIFO traversal processes disjoint ranges without changing their established prefixes. */
        const range = this.#pending.pop()!
        if (range.end - range.start <= nativeKeySortLimit) {
          this.#sortSmallRange(keys, range)
          continue
        }
        /** Shared prefixes advance from the current depth once, without bucket work or rescans. */
        let depth = range.depth
        while (this.#sharesCodeUnit(keys, range.start, range.end, depth)) depth++
        /** Ended keys precede code unit zero and never enter either 256-bucket byte pass. */
        const liveStart = this.#distribute(keys, range.start, range.end, depth)
        this.#queueChildren(keys, liveStart, range.end, depth)
      }
    } finally {
      this.#scratch.length = 0
      this.#pending.length = 0
    }
  }

  /** One final bounded native sort never sends the same key back through another comparison sort. */
  #sortSmallRange(keys: string[], range: IKeyOrderRange): void {
    /** The range contains at most nativeKeySortLimit (32) keys, fixed at compilation. */
    const ordered = keys.slice(range.start, range.end).sort()
    for (let index = 0; index < ordered.length; index++) keys[range.start + index] = ordered[index]!
  }

  /** Skip a common code unit once per key; a terminated prefix must instead be partitioned. */
  #sharesCodeUnit(keys: readonly string[], start: number, end: number, depth: number): boolean {
    /** Unique record keys cannot all terminate at the same suffix depth in a multi-key range. */
    const first = keys[start]!
    if (first.length === depth) return false
    /** UTF-16 comparison observes code units, preserving lone surrogates and surrogate pairs. */
    const unit = first.charCodeAt(depth)
    for (let index = start + 1; index < end; index++) {
      /** Each key is read at the current suffix position, never compared again from position zero. */
      const key = keys[index]!
      if (key.length === depth || key.charCodeAt(depth) !== unit) return false
    }
    return true
  }

  /** Partition end-of-string first, then stably sort one full code unit using low and high bytes. */
  #distribute(keys: string[], start: number, end: number, depth: number): number {
    this.#lowCounts.fill(0)
    this.#highCounts.fill(0)
    /** A shorter prefix sorts before every live UTF-16 code unit, including U+0000. */
    let ended = 0
    for (let index = start; index < end; index++) {
      /** Each live code unit contributes to both byte counts in the same character scan. */
      const key = keys[index]!
      if (key.length === depth) {
        ended++
        continue
      }
      /** Byte splitting avoids a 65,536-bucket table for a single UTF-16 code unit. */
      const unit = key.charCodeAt(depth)
      this.#lowCounts[unit & 255]!++
      this.#highCounts[unit >>> 8]!++
    }
    /** Prefix terminators stay outside both byte distributions. */
    const liveStart = start + ended
    this.#setPositions(this.#lowCounts, liveStart)
    /** Terminal positions preserve any prefix keys before the live byte ranges. */
    let terminal = start
    for (let index = start; index < end; index++) {
      /** First pass is stable by the low byte into the shared temporary range. */
      const key = keys[index]!
      if (key.length === depth) this.#scratch[terminal++] = key
      else this.#scratch[this.#positions[key.charCodeAt(depth) & 255]!++] = key
    }
    this.#setPositions(this.#highCounts, liveStart)
    for (let index = liveStart; index < end; index++) {
      /** Stable high-byte ordering retains the low-byte order within each high-byte bucket. */
      const key = this.#scratch[index]!
      keys[this.#positions[key.charCodeAt(depth) >>> 8]!++] = key
    }
    for (let index = start; index < liveStart; index++) keys[index] = this.#scratch[index]!
    return liveStart
  }

  /** Compute counting-sort cursors over the compile-time 256 possible byte values. */
  #setPositions(counts: Uint32Array, start: number): void {
    /** Cursor advances once across the fixed byte alphabet, independent of key prefix length. */
    let position = start
    // The byte alphabet is fixed at codeUnitByteBuckets = 256, from the UTF-16 byte split above.
    for (let bucket = 0; bucket < codeUnitByteBuckets; bucket++) {
      this.#positions[bucket] = position
      position += counts[bucket]!
    }
  }

  /** Only equal full code units share a deeper MSD task; singleton ranges are already ordered. */
  #queueChildren(keys: readonly string[], start: number, end: number, depth: number): void {
    if (start === end) return
    /** Adjacent complete code units identify disjoint ranges after both stable byte passes. */
    let unit = keys[start]!.charCodeAt(depth)
    /** First index of the current equal-code-unit group. */
    let groupStart = start
    for (let index = start + 1; index < end; index++) {
      /** A group boundary advances suffix depth without revisiting its earlier prefix. */
      const nextUnit = keys[index]!.charCodeAt(depth)
      if (nextUnit === unit) continue
      if (index - groupStart > 1)
        this.#pending.push({ start: groupStart, end: index, depth: depth + 1 })
      groupStart = index
      unit = nextUnit
    }
    if (end - groupStart > 1) this.#pending.push({ start: groupStart, end, depth: depth + 1 })
  }
}

/**
 * Canonicalize only detached portable projections; caller getters and value admission stay
 * upstream.
 */
export class CacheKeyNormalizer {
  /** Large records share one lazily allocated radix workspace across all request parts. */
  #radix: CacheKeyRadixOrder | undefined

  /** Retain original part order while each nested record receives the historical key order. */
  normalize(parts: readonly ICodecValue[]): ICodecValue[] {
    /** The normalized part list is the sole input to the existing JSON and SHA-256 path. */
    const normalized: ICodecValue[] = []
    /** Each projected request part retains its original position in the hashed tuple. */
    for (const part of parts) normalized.push(this.#value(part))
    return normalized
  }

  /** Recurse over the owned projection, preserving array position and primitive identity. */
  #value(value: ICodecValue): ICodecValue {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) {
      /**
       * Serialize's fresh mutable array remains detached; preserving it avoids another species
       * call.
       */
      const projected = value as ICodecValue[]
      for (let index = 0; index < projected.length; index++)
        projected[index] = this.#value(projected[index]!)
      return projected
    }
    /** Own data fields were already copied by serialize; this stage never reads the caller again. */
    const record = value as Readonly<Record<string, ICodecValue>>
    /** Key enumeration supplies the complete input to this package's canonical order owner. */
    const keys = Object.keys(record)
    if (keys.length <= nativeKeySortLimit) {
      // Object.keys has at most nativeKeySortLimit (32) entries on this branch, fixed above.
      keys.sort()
    } else {
      this.#radix ??= new CacheKeyRadixOrder()
      this.#radix.sort(keys)
    }
    /** Ordinary objects reproduce the legacy projector's integer-index enumeration behavior. */
    const normalized: Record<string, ICodecValue> = {}
    /** Sorted own keys are installed as data fields before JSON applies integer-index enumeration. */
    for (const key of keys) {
      Object.defineProperty(normalized, key, {
        value: this.#value(record[key]!),
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
    return normalized
  }
}
