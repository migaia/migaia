import type { IRpcProbeDescriptor } from '@migaia/rpc-core/probe'
import type { IRpcDevtoolsWireEvent } from './wire.js'

/** Query limits are at most 1,000; filters are applied to one collector's retained sequence. */
export type IRpcDevtoolsQuery = Readonly<{
  afterSeq?: number
  limit?: number
  stages?: readonly string[]
  methods?: readonly string[]
  trace?: string
  endpointIds?: readonly string[]
}>

/** Loss counters explain bounded retention, interning and the collector's lifecycle decisions. */
export type IRpcDevtoolsCounters = Readonly<{
  evicted: number
  contentDropped: number
  droppedReentrant: number
  sampledOut: number
  ignoredWhilePaused: number
  ignoredAfterClose: number
  internOverflow: number
}>

/** Pages carry the next sequence cursor and the loss counters observed with that snapshot. */
export type IRpcDevtoolsPage = Readonly<{
  events: readonly IRpcDevtoolsWireEvent[]
  nextSeq: number
  counters: IRpcDevtoolsCounters
}>

/**
 * Histograms use 24 boundaries, 0.0625 ms × 2^k for k=0…23. Percentiles interpolate within a
 * bucket, with error bounded by its width; ring eviction does not reset these aggregates.
 */
export type IRpcDevtoolsStats = Readonly<{
  since: number
  methods: readonly Readonly<{
    endpointId: string
    method: string
    calls: number
    failed: number
    rejected: number
    timedOut: number
    aborted: number
    latencyBucketsMs: readonly number[]
    latencyCounts: readonly number[]
    p50Ms: number
    p95Ms: number
    p99Ms: number
  }>[]
}>

/** Describe supplies the target's current clock sample, active descriptors and retention limits. */
export type IRpcDevtoolsDescribe = Readonly<{
  version: string
  now: number
  paused: boolean
  descriptors: readonly IRpcProbeDescriptor[]
  limits: Readonly<{ maxEvents: number; maxContentBytes: number }>
  counters: IRpcDevtoolsCounters
}>

/** Watch batches account for loss while the consumer was slower than the collector. */
export type IRpcDevtoolsWatchBatch = Readonly<{
  events: readonly IRpcDevtoolsWireEvent[]
  dropped: number
}>

/** Users attach this nested service object to their existing Peer; it owns no connection. */
export type IRpcDevtoolsServiceApi = {
  describe(): IRpcDevtoolsDescribe
  query(input?: IRpcDevtoolsQuery): IRpcDevtoolsPage
  watch(
    input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>
  ): AsyncGenerator<IRpcDevtoolsWatchBatch>
  stats(): IRpcDevtoolsStats
  record: { start(input?: Readonly<{ maxEvents?: number }>): void; stop(): string }
  clear(): void
  pause(): void
  resume(): void
}
