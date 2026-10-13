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

/** Collector construction options are frozen now; defaults and ingestion belong to layer 2. */
export type IRpcDevtoolsOptions = Readonly<{
  /** Defaults to message and peer; pass physical stages here or use setStages() to enable them. */
  stages?: readonly IRpcProbeStageName[]
  capture?: readonly IRpcProbeStageName[]
  redact?(stage: RpcProbeStage, content: unknown): unknown
  methods?: readonly string[]
  sample?: number
  maxEvents?: number
  maxContentBytes?: number
  /** Bounds the reader name table; ingestion retains raw string references without interning. */
  maxInterned?: number
  exposeContent?: boolean
  onError?(error: unknown): void
}>

/** A collector is directly installable as a probe; callers own its serving Peer and its lifetime. */
export type IRpcDevtools = IRpcProbe &
  Readonly<{
    /** Collector-owned ingestion exists before host-form defineProbe attaches the compiled fields. */
    emit(view: IRpcProbeEventView): void
    query(input?: IRpcDevtoolsQuery): IRpcDevtoolsPage
    watch(
      input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>
    ): AsyncGenerator<IRpcDevtoolsWatchBatch>
    stats(): IRpcDevtoolsStats
    describe(): IRpcDevtoolsDescribe
    record(options?: Readonly<{ maxEvents?: number }>): Readonly<{ stop(): IRpcDevtoolsRecord }>
    exportRecord(record: IRpcDevtoolsRecord): string
    importRecord(text: string): IRpcDevtoolsRecord
    pause(): void
    resume(): void
    clear(): void
    close(): void
    readonly service: IRuntimePeerProvide
  }>
