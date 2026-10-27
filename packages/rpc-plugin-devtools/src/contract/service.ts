/** Defines collector query, watch, statistics and lifecycle service shapes for Host providers. */
import type { IRpcProbeDescriptor } from '@migaia/rpc-host/plugins/probe'
import type { IRpcDevtoolsWireEvent } from './wire.js'

/** Query limits are at most 1,000; filters are applied to one collector's retained sequence. */
export type IRpcDevtoolsQuery = Readonly<{
  /** Exclusive sequence cursor, default 0; a nonnegative safe integer, not a ring offset. */
  afterSeq?: number
  /** Default 1000; safe integer from 1 through 1000, applied after filtering. */
  limit?: number
  /** Canonical stage selection; omitted matches all retained stages and [] matches none. */
  stages?: readonly string[]
  /** Selects canonical outcome names before the numeric event scan or watch ingestion. */
  outcomes?: readonly string[]
  /** Optional exact method names; [] matches no method. */
  methods?: readonly string[]
  /** Optional exact trace key; omission does not filter traces. */
  trace?: string
  /** Optional endpoint selection, distinct from hub registration names. */
  endpointIds?: readonly string[]
}>

/** Loss counters explain bounded retention, interning and the collector's lifecycle decisions. */
export type IRpcDevtoolsCounters = Readonly<{
  /** Events displaced by main-ring capacity. */
  evicted: number
  /** Captured payloads discarded by the main-ring content budget. */
  contentDropped: number
  /** Emits skipped while this collector is already consuming a view. */
  droppedReentrant: number
  /** Direct emits excluded by the configured sample threshold. */
  sampledOut: number
  /** Direct emits skipped while paused; emitter subscription gating may prevent emits entirely. */
  ignoredWhilePaused: number
  /** Direct emits ignored after close. */
  ignoredAfterClose: number
  /** Reader name insertions rejected by the bounded intern table. */
  internOverflow: number
}>

/** Pages carry the next sequence cursor and the loss counters observed with that snapshot. */
export type IRpcDevtoolsPage = Readonly<{
  /** Matching retained events in sequence order; nested reference ownership is unchanged. */
  events: readonly IRpcDevtoolsWireEvent[]
  /** Last scanned sequence, including excluded rows; use as the next afterSeq. */
  nextSeq: number
  /** Snapshot for this read, not live mutable counters. */
  counters: IRpcDevtoolsCounters
}>

/**
 * Histograms use 24 boundaries, 0.0625 ms × 2^k for k=0…23. Percentiles interpolate within a
 * bounded bucket. The terminal bucket is open above latencyOverflowFromMs; quantiles are clamped to
 * latencyMaxMs. Ring eviction does not reset these aggregates.
 */
export type IRpcDevtoolsStats = Readonly<{
  /** Wall-clock epoch milliseconds at this statistics window's start; clear starts a new window. */
  since: number
  /** Raw endpoint/method pairs evicted by the 4096-pair FIFO budget since the last clear. */
  evictedPairs: number
  /** Endpoint/method aggregates, independent of retained query-ring eviction. */
  methods: readonly Readonly<{
    /** Endpoint supplying the observation. */
    endpointId: string
    /** Observed method path. */
    method: string
    /** Qualifying settled, failed or rejected message observations. */
    calls: number
    /**
     * Failed-outcome observations; timeout/abort classifications can also increment their own
     * counters.
     */
    failed: number
    /** Admission rejections. */
    rejected: number
    /** Failures classified by Core/native timeout identity. */
    timedOut: number
    /** Failures classified by Core/native cancellation identity. */
    aborted: number
    /** Fixed 24 histogram labels in milliseconds; the terminal bucket has no finite upper bound. */
    latencyBucketsMs: readonly number[]
    /** Counts corresponding to the histogram buckets. */
    latencyCounts: readonly number[]
    /** The final bucket has no upper bound; this value is its exclusive lower boundary. */
    latencyOverflowFromMs?: number
    /** Observed maximum bounds interpolation honestly, including the open terminal bucket. */
    latencyMaxMs?: number
    /** Interpolated median, bounded by the observed maximum. */
    p50Ms: number
    /** Interpolated 95th percentile, not an exact retained-sample quantile. */
    p95Ms: number
    /** Interpolated 99th percentile using the same histogram bounds. */
    p99Ms: number
  }>[]
}>

/** Describe supplies the target's current clock sample, active descriptors and retention limits. */
export type IRpcDevtoolsDescribe = Readonly<{
  /** Service contract version, not the package release version. */
  version: string
  /** Monotonic milliseconds in the default Core event clock domain, not an epoch timestamp. */
  now: number
  /** Whether stage subscriptions are temporarily removed. */
  paused: boolean
  /** Current descriptor elements retain their Core references. */
  descriptors: readonly IRpcProbeDescriptor[]
  /** Main-ring capacity/budget only; recording and watch windows are independent. */
  limits: Readonly<{ maxEvents: number; maxContentBytes: number }>
  /** Current loss-counter snapshot. */
  counters: IRpcDevtoolsCounters
}>

/** Watch batches account for loss while the consumer was slower than the collector. */
export type IRpcDevtoolsWatchBatch = Readonly<{
  /** At most 256 matching future events, subscribed from the first next. */
  events: readonly IRpcDevtoolsWireEvent[]
  /** Loss since last delivery, including raw pre-filter overwrite and old queued batches. */
  dropped: number
}>

/** Users attach this nested service object to their existing Peer; it owns no connection. */
export type IRpcDevtoolsServiceApi = {
  /** Portable description; also identifies the serving endpoint to exclude its own traffic. */
  describe(): IRpcDevtoolsDescribe
  /** Portable retained history; content follows the exposeContent setting. */
  query(input?: IRpcDevtoolsQuery): IRpcDevtoolsPage
  /** Stream future batches, releasing this watch through the existing cancellation signal. */
  watch(
    input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>
  ): AsyncGenerator<IRpcDevtoolsWatchBatch>
  /** Portable cumulative statistics rather than retained-ring counts. */
  stats(): IRpcDevtoolsStats
  /** One recording start/stop pair; stop returns NDJSON, duplicate/missing operations reject. */
  record: { start(input?: Readonly<{ maxEvents?: number }>): void; stop(): string }
  /** Clear main retention/statistics/counters, leaving recording/watch ownership intact. */
  clear(): void
  /** Suspend subscriptions without closing the serving Peer. */
  pause(): void
  /** Restore the saved stage selection unless closed. */
  resume(): void
}
