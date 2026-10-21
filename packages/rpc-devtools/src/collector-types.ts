import type {
  IRpcProbe,
  IRpcProbeEventView,
  IRpcProbeStageName,
  RpcProbeStage
} from '@migaia/rpc-core/probe'
import type { IRuntimePeerProvide } from '@migaia/rpc-core/remote'
import type {
  IRpcDevtoolsDescribe,
  IRpcDevtoolsPage,
  IRpcDevtoolsQuery,
  IRpcDevtoolsStats,
  IRpcDevtoolsWatchBatch
} from './contract/service.js'
import type { IRpcDevtoolsRecord } from './contract/record.js'

/** Configure bounded observation storage without creating a Peer, transport or persistence owner. */
export type IRpcDevtoolsOptions = Readonly<{
  /** Defaults to message and peer; pass physical stages here or use setStages() to enable them. */
  stages?: readonly IRpcProbeStageName[]
  /** Explicit captured stages, default none; capture must be a subset of subscribed stages. */
  capture?: readonly IRpcProbeStageName[]
  /** Optional synchronous projection; throws report REDACT_FAILED and discard this content. */
  redact?(stage: RpcProbeStage, content: unknown): unknown
  /** Optional exact method selection compiled by Core; omission observes all eligible methods. */
  methods?: readonly string[]
  /** Deterministic sampling ratio, default 1; greater than 0 and at most 1. */
  sample?: number
  /** Main-ring capacity, default 10000; positive safe integer within JavaScript array limits. */
  maxEvents?: number
  /** Main-ring budget, default 8388608 bytes, allowing 0; record/watch references are independent. */
  maxContentBytes?: number
  /** Reader name capacity, default 65536; positive bounded safe integer, with overflow counted. */
  maxInterned?: number
  /** Defaults to false; only true permits captured content across the remote service boundary. */
  exposeContent?: boolean
  /** Optional diagnostic sink; omission or a throwing sink uses Core's host failure route. */
  onError?(error: unknown): void
}>

/** A collector is directly installable as a probe; callers own its serving Peer and its lifetime. */
export type IRpcDevtools = IRpcProbe &
  Readonly<{
    /**
     * Consume a reusable Core view now; metadata is copied, nested error/content/detail retain
     * references.
     */
    emit(view: IRpcProbeEventView): void
    /** Read retained history after a sequence cursor; locally captured content is available. */
    query(input?: IRpcDevtoolsQuery): IRpcDevtoolsPage
    /**
     * A local iterator return wakes its pending next and releases only that watch, not the
     * Collector. First next subscribes to future events; query reads history. Batches contain at
     * most 256 events with 64 queued batches and a loss count. Collector close rejects pending next
     * with CLOSED rather than leaving it suspended.
     */
    watch(
      input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>
    ): AsyncGenerator<IRpcDevtoolsWatchBatch>
    /** Snapshot cumulative eligible message statistics; ring eviction does not reset them. */
    stats(): IRpcDevtoolsStats
    /**
     * Read the current monotonic clock, descriptors, limits and counter snapshot; rejects after
     * close.
     */
    describe(): IRpcDevtoolsDescribe
    /**
     * Start the sole independent recording; maxEvents defaults to the main capacity, and stop
     * consumes this handle.
     */
    record(options?: Readonly<{ maxEvents?: number }>): Readonly<{ stop(): IRpcDevtoolsRecord }>
    /** Pure NDJSON encoding, without persistence or an open-collector requirement. */
    exportRecord(record: IRpcDevtoolsRecord): string
    /** Pure decoding, without ingesting events into this collector; usable after close. */
    importRecord(text: string): IRpcDevtoolsRecord
    /** Temporarily remove current stages and save their selection; repeated pause is harmless. */
    pause(): void
    /** Restore the saved selection, without reviving a closed collector. */
    resume(): void
    /**
     * Reset the main ring, statistics and counters, retaining sequence progress and record/watch
     * ownership.
     */
    clear(): void
    /** Synchronously retire storage and wake watches; idempotent, without closing any serving Peer. */
    close(): void
    /** Nested provide object; wire content is hidden unless exposeContent is true. */
    readonly service: IRuntimePeerProvide
  }>
