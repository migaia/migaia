import { RpcProbeOutcome, RpcProbeStage, type IRpcProbeEventView } from '@migaia/rpc-core/probe'
import type { IRpcDevtoolsStats } from '../contract/service.js'
import { NameTable } from './intern.js'
import { CollectorLimit } from './text.js'
import { reportFailure } from './report.js'
import { classifyRpcFailure, RpcDevtoolsFailure } from './failure.js'

/** Five counters and the terminal-bin maximum precede the 24 histogram bins without padding. */
const StatsWidth = 6 + CollectorLimit.histogram

/** Numeric statistics grow only for a new endpoint/method pair, independent of ring eviction. */
export class CollectorStats {
  /** Stable numeric pair keys select a dense fixed-width statistics slot. */
  #slots = new Map<number, number>()
  /** Numeric counts avoid per-event object or array allocation after warm-up. */
  #data = new Float64Array(16 * StatsWidth)
  /** Export identities stay numeric until stats() crosses its public boundary. */
  #endpoints = new Int32Array(16)
  /** Dense method identities share the collector's bounded name table. */
  #methods = new Int32Array(16)
  /** Dense pair-key stride is compiled once from the supported name capacity. */
  #stride: number
  /** Name table owns restoration and remains alive while statistics retain ids. */
  #names: NameTable
  /** Failed application error getters are reported without interrupting histogram or other rings. */
  #onError: ((error: unknown) => void) | undefined
  /** Clear establishes a fresh aggregation epoch without resetting the collector sequence. */
  #since = Date.now()

  /** Each pair's histogram is independent of retention in any event ring. */
  constructor(names: NameTable, maxInterned: number, onError?: (error: unknown) => void) {
    this.#names = names
    this.#stride = maxInterned + 1
    this.#onError = onError
  }

  /** Count only completed logical messages that carry a measured nonnegative duration. */
  update(view: IRpcProbeEventView, endpoint: number, method: number): void {
    if (view.stage !== RpcProbeStage.message || view.durationMs < 0 || method < 0) return
    if (
      view.outcome !== RpcProbeOutcome.settled &&
      view.outcome !== RpcProbeOutcome.failed &&
      view.outcome !== RpcProbeOutcome.rejected
    )
      return
    /** One numeric key avoids a string concatenation on every observation. */
    const key = endpoint * this.#stride + method
    /** New pair discovery is the only statistics allocation after construction. */
    let slot = this.#slots.get(key)
    if (slot === undefined) {
      slot = this.#slots.size
      if (slot === this.#endpoints.length) {
        /** Growth is a necessary representation change for a newly observed pair (SC9b). */
        const data = new Float64Array(this.#data.length * 2)
        data.set(this.#data)
        this.#data = data
        /** Growing numeric identities preserves all existing aggregation slots (SC9b). */
        const endpoints = new Int32Array(this.#endpoints.length * 2)
        endpoints.set(this.#endpoints)
        this.#endpoints = endpoints
        /** Method ids grow with their matching endpoint columns (SC9b). */
        const methods = new Int32Array(this.#methods.length * 2)
        methods.set(this.#methods)
        this.#methods = methods
      }
      this.#slots.set(key, slot)
      this.#endpoints[slot] = endpoint
      this.#methods[slot] = method
    }
    /** Offset selects the fixed counter block without constructing an aggregate object. */
    const offset = slot * StatsWidth
    this.#data[offset]!++
    if (view.outcome === RpcProbeOutcome.failed) this.#data[offset + 1]!++
    if (view.outcome === RpcProbeOutcome.rejected) this.#data[offset + 2]!++
    try {
      /** The shared owner prevents statistics and logging from classifying the same error twice. */
      const failure = classifyRpcFailure(view.error)
      if (failure === RpcDevtoolsFailure.timeout) this.#data[offset + 3]!++
      else if (failure === RpcDevtoolsFailure.aborted) this.#data[offset + 4]!++
    } catch (failure) {
      reportFailure(failure, this.#onError)
    }
    /** Log2 selects a bounded histogram bin in O(1), including the terminal overflow bucket. */
    const bucket =
      view.durationMs <= 0.0625 ? 0 : Math.min(23, Math.ceil(Math.log2(view.durationMs * 16)))
    this.#data[offset + 6 + bucket]!++
    /** The terminal bin's measured maximum keeps interpolation useful for long calls. */
    if (view.durationMs > this.#data[offset + 5]!) this.#data[offset + 5] = view.durationMs
  }

  /** Interpolate a rank within its histogram bucket; no sorting or retained samples are needed. */
  #percentile(offset: number, percentile: number): number {
    /** Rank is defined over the completed-call count for this one method. */
    const rank = this.#data[offset]! * percentile
    /** Earlier bins contribute only a running count; the first nonempty rank bin terminates. */
    let before = 0
    for (let bucket = 0; bucket < 24; bucket++) {
      /** One stored bin determines the fraction of the bounded interpolation interval. */
      const count = this.#data[offset + 6 + bucket]!
      if (count !== 0 && before + count >= rank) {
        /** Bucket zero starts at zero; following bins double their preceding upper boundary. */
        const low = bucket === 0 ? 0 : 0.0625 * 2 ** (bucket - 1)
        /** Last-bin overflow includes its observed maximum, rather than inventing a cutoff. */
        const high =
          bucket === 23
            ? Math.max(0.0625 * 2 ** bucket, this.#data[offset + 5]!)
            : 0.0625 * 2 ** bucket
        return Math.min(this.#data[offset + 5]!, low + ((high - low) * (rank - before)) / count)
      }
      before += count
    }
    return 0
  }

  /** Materialize statistics only at this public representation boundary (SC9b). */
  snapshot(excluded?: ReadonlySet<string>): IRpcDevtoolsStats {
    /** Output rows are boundary projections, separate from the hot numeric aggregation blocks. */
    const methods: IRpcDevtoolsStats['methods'][number][] = []
    for (let slot = 0; slot < this.#slots.size; slot++) {
      /** Offset and fixed vectors reconstruct the one published histogram vocabulary. */
      const offset = slot * StatsWidth
      if (excluded?.has(this.#names.name(this.#endpoints[slot]!)!)) continue
      /** Bucket boundaries are a public representation, constructed only for stats(). */
      const boundaries: number[] = []
      /** Counts leave numeric storage only when this boundary is requested. */
      const counts: number[] = []
      for (let bucket = 0; bucket < 24; bucket++) {
        boundaries.push(0.0625 * 2 ** bucket)
        counts.push(this.#data[offset + 6 + bucket]!)
      }
      methods.push({
        endpointId: this.#names.name(this.#endpoints[slot]!)!,
        method: this.#names.name(this.#methods[slot]!)!,
        calls: this.#data[offset]!,
        failed: this.#data[offset + 1]!,
        rejected: this.#data[offset + 2]!,
        timedOut: this.#data[offset + 3]!,
        aborted: this.#data[offset + 4]!,
        latencyBucketsMs: boundaries,
        latencyCounts: counts,
        latencyOverflowFromMs: 0.0625 * 2 ** 22,
        latencyMaxMs: this.#data[offset + 5]!,
        p50Ms: this.#percentile(offset, 0.5),
        p95Ms: this.#percentile(offset, 0.95),
        p99Ms: this.#percentile(offset, 0.99)
      })
    }
    return { since: this.#since, methods }
  }

  /** Clear resets aggregates while preserving already allocated numeric capacity. */
  clear(): void {
    this.#slots.clear()
    this.#data.fill(0)
    this.#since = Date.now()
  }
}
