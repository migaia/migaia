import { RpcProbeOutcome, RpcProbeStage, type IRpcProbeEventView } from '@migaia/rpc-host/probe'
import type { IRpcDevtoolsStats } from '../contract/service.js'
import { NameTable } from './intern.js'
import { CollectorLimit } from './text.js'
import { reportFailure } from './report.js'
import { classifyRpcFailure, RpcDevtoolsFailure } from './failure.js'

/** Five counters and the terminal-bin maximum precede the 24 histogram bins without padding. */
const StatsWidth = 6 + CollectorLimit.histogram

/** Numeric statistics grow only for a new endpoint/method pair, independent of ring eviction. */
export class CollectorStats {
  /** Raw endpoint/method pairs select dense fixed-width statistics slots. */
  #slots = new Map<string, Map<string, number>>()
  /** Pair count indexes fixed-width counters independently of endpoint map size. */
  #count = 0
  /** Numeric counts avoid per-event object or array allocation after warm-up. */
  #data = new Float64Array(16 * StatsWidth)
  /** Endpoint references remain raw until stats() crosses its public boundary. */
  #endpoints = Array.from<string | undefined>({ length: 16 })
  /** Method references remain separate from the cold bounded name table. */
  #methods = Array.from<string | undefined>({ length: 16 })
  /** Name table normalizes strings only when statistics cross a public boundary. */
  #names: NameTable
  /** Failed application error getters are reported without interrupting histogram or other rings. */
  #onError: ((error: unknown) => void) | undefined
  /** Clear establishes a fresh aggregation epoch without resetting the collector sequence. */
  #since = Date.now()

  /** Each pair's histogram is independent of retention in any event ring. */
  constructor(names: NameTable, onError?: (error: unknown) => void) {
    this.#names = names
    this.#onError = onError
  }

  /** Count only completed logical messages that carry a measured nonnegative duration. */
  update(view: IRpcProbeEventView): void {
    if (view.stage !== RpcProbeStage.message || view.durationMs < 0 || view.method === undefined)
      return
    if (
      view.outcome !== RpcProbeOutcome.settled &&
      view.outcome !== RpcProbeOutcome.failed &&
      view.outcome !== RpcProbeOutcome.rejected
    )
      return
    /** String pair lookup performs no concatenation or intern-table operation on settlement. */
    let methods = this.#slots.get(view.endpointId)
    if (methods === undefined) {
      methods = new Map()
      this.#slots.set(view.endpointId, methods)
    }
    /** First observation of a pair owns its raw identity and its aggregation slot. */
    let slot = methods.get(view.method)
    if (slot === undefined) {
      slot = this.#count++
      if (slot === this.#endpoints.length) {
        /** Numeric growth occurs only on first observation of a new supported pair. */
        const data = new Float64Array(this.#data.length * 2)
        data.set(this.#data)
        this.#data = data
        this.#endpoints.length *= 2
        this.#methods.length *= 2
      }
      methods.set(view.method, slot)
      this.#endpoints[slot] = view.endpointId
      this.#methods[slot] = view.method
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
  #percentile(data: Float64Array, offset: number, percentile: number): number {
    /** Rank is defined over the completed-call count for this one method. */
    const rank = data[offset]! * percentile
    /** Earlier bins contribute only a running count; the first nonempty rank bin terminates. */
    let before = 0
    for (let bucket = 0; bucket < 24; bucket++) {
      /** One stored bin determines the fraction of the bounded interpolation interval. */
      const count = data[offset + 6 + bucket]!
      if (count !== 0 && before + count >= rank) {
        /** Bucket zero starts at zero; following bins double their preceding upper boundary. */
        const low = bucket === 0 ? 0 : 0.0625 * 2 ** (bucket - 1)
        /** Last-bin overflow includes its observed maximum, rather than inventing a cutoff. */
        const high =
          bucket === 23 ? Math.max(0.0625 * 2 ** bucket, data[offset + 5]!) : 0.0625 * 2 ** bucket
        return Math.min(data[offset + 5]!, low + ((high - low) * (rank - before)) / count)
      }
      before += count
    }
    return 0
  }

  /** Materialize statistics only at this public representation boundary. */
  snapshot(excluded?: ReadonlySet<string>): IRpcDevtoolsStats {
    /** Cold identity collisions retain the prior numeric-key semantics, including overflow id zero. */
    const slots = new Map<number, Map<number, number>>()
    /** One temporary block merges counters and histograms without altering raw settlement storage. */
    const data = new Float64Array(this.#count * StatsWidth)
    /** Projected endpoint ids are scoped to this snapshot and never enter ingestion. */
    const endpoints: number[] = []
    /**
     * Projected method ids identify the same public aggregate domain as the previous hot intern
     * keys.
     */
    const methodIds: number[] = []
    for (let rawSlot = 0; rawSlot < this.#count; rawSlot++) {
      if (excluded?.has(this.#endpoints[rawSlot]!)) continue
      /**
       * Service exclusion precedes projection so overflow cannot merge a hidden endpoint into a
       * visible row.
       */
      const endpoint = this.#names.id(this.#endpoints[rawSlot])
      /** Names are normalized only here, including methods whose raw events were already evicted. */
      const method = this.#names.id(this.#methods[rawSlot])
      /**
       * Numeric membership groups pairs without concatenated keys or another persistent identity
       * owner.
       */
      let endpointSlots = slots.get(endpoint)
      if (endpointSlots === undefined) {
        endpointSlots = new Map()
        slots.set(endpoint, endpointSlots)
      }
      /** First projected pair preserves the original insertion order of public statistics rows. */
      let slot = endpointSlots.get(method)
      if (slot === undefined) {
        slot = endpoints.length
        endpointSlots.set(method, slot)
        endpoints.push(endpoint)
        methodIds.push(method)
      }
      /** Source and destination offsets share the existing fixed-width statistics layout. */
      const rawOffset = rawSlot * StatsWidth
      /** Only cold snapshot blocks merge identities that normalize to the same pair. */
      const offset = slot * StatsWidth
      for (let counter = 0; counter < 5; counter++)
        data[offset + counter]! += this.#data[rawOffset + counter]!
      data[offset + 5] = Math.max(data[offset + 5]!, this.#data[rawOffset + 5]!)
      for (let bucket = 0; bucket < CollectorLimit.histogram; bucket++)
        data[offset + 6 + bucket]! += this.#data[rawOffset + 6 + bucket]!
    }
    /** Output rows are boundary projections, separate from the hot numeric aggregation blocks. */
    const methods: IRpcDevtoolsStats['methods'][number][] = []
    for (let slot = 0; slot < endpoints.length; slot++) {
      /** Offset reconstructs the one published histogram vocabulary from the merged snapshot. */
      const offset = slot * StatsWidth
      /** Bucket boundaries are a public representation, constructed only for stats(). */
      const boundaries: number[] = []
      /** Counts leave numeric storage only when this boundary is requested. */
      const counts: number[] = []
      for (let bucket = 0; bucket < CollectorLimit.histogram; bucket++) {
        boundaries.push(0.0625 * 2 ** bucket)
        counts.push(data[offset + 6 + bucket]!)
      }
      methods.push({
        endpointId: this.#names.name(endpoints[slot]!)!,
        method: this.#names.name(methodIds[slot]!)!,
        calls: data[offset]!,
        failed: data[offset + 1]!,
        rejected: data[offset + 2]!,
        timedOut: data[offset + 3]!,
        aborted: data[offset + 4]!,
        latencyBucketsMs: boundaries,
        latencyCounts: counts,
        latencyOverflowFromMs: 0.0625 * 2 ** 22,
        latencyMaxMs: data[offset + 5]!,
        p50Ms: this.#percentile(data, offset, 0.5),
        p95Ms: this.#percentile(data, offset, 0.95),
        p99Ms: this.#percentile(data, offset, 0.99)
      })
    }
    return { since: this.#since, methods }
  }

  /** Clear resets aggregates while preserving already allocated numeric capacity. */
  clear(): void {
    this.#slots.clear()
    this.#count = 0
    this.#endpoints.fill(undefined)
    this.#methods.fill(undefined)
    this.#data.fill(0)
    this.#since = Date.now()
  }
}
