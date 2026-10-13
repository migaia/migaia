import type { IRpcProbeStageName, RpcProbeStage } from './constants.js'

/** Fixed-shape mutable view reused by one emitter; valid only during its synchronous emit call. */
export type IRpcProbeEventView = {
  seq: number
  /** Inbound physical carrier sequence carried through this frame; -1 means no carrier link. */
  carrierSeq: number
  at: number
  endpointId: string
  stage: number
  direction: number
  kind: number
  outcome: number
  messageId: string | undefined
  method: string | undefined
  /** Original variation route name on message/envelope observations; absent on other stages. */
  variation: string | undefined
  senderId: string | undefined
  targetId: string | undefined
  receiverId: string | undefined
  peerId: string | undefined
  trace: string | undefined
  /** -1 means the observing layer cannot determine a byte size. */
  sizeBytes: number
  /** -1 means this event is not a chunk. */
  chunkIndex: number
  /** -1 means this event is not a chunk. */
  chunkCount: number
  /** -1 means this event is not a batch. */
  members: number
  /** -1 means this event does not represent settlement. */
  durationMs: number
  rejection: string | undefined
  lifecycle: string | undefined
  error: unknown
  carrier: string | undefined
  detail: Readonly<Record<string, string | number | boolean>> | undefined
  /** Present only for captured stages, after the owning emitter applies redaction. */
  content: unknown
}

/** Cold endpoint capabilities describe which stages can actually produce observations. */
export type IRpcProbeDescriptor = Readonly<{
  endpointId: string
  platform: string
  topology?: string
  encodedType?: string
  authentication: 'none' | 'sign' | 'encrypt-sign'
  fastPath: boolean
  carrier: string | 'unavailable'
  stageMask: number
}>

/** Definition-time options compile once; capture is opt-in and initially a subset of stages. */
export type IRpcProbeDefinition = Readonly<{
  stages: readonly IRpcProbeStageName[]
  capture?: readonly IRpcProbeStageName[]
  redact?(stage: RpcProbeStage, content: unknown): unknown
  /** Filters method-bearing logical/envelope events; methodless variation controls remain visible. */
  methods?: readonly string[]
  sample?: number
  describe?(descriptor: IRpcProbeDescriptor): void
  emit(view: IRpcProbeEventView): void
  onError?(error: unknown): void
}>

/**
 * Frozen public handle retains compiled filters while private stage updates can pause or resume it.
 * Standalone stageMask is a getter; a host's data field retains its initial compiled mask (D7).
 * Emitters read private state once at installation and use their own fixed-shape records
 * thereafter.
 */
export type IRpcProbe = Readonly<{
  readonly stageMask: number
  readonly captureMask: number
  readonly methods: ReadonlySet<string> | undefined
  /** 0xffffffff means all events; other values compare against the unsigned sample key. */
  readonly sampleThreshold: number
  /** An empty list pauses the probe; validation failures leave the previous mask unchanged. */
  setStages(stages: readonly IRpcProbeStageName[]): void
}>

/** Transport capability receives physical observations without owning the endpoint emitter. */
export type IRpcCarrierProbe = Readonly<{
  readonly capturing: boolean
  emit(
    direction: number,
    sizeBytes: number,
    carrier: string,
    detail: Readonly<Record<string, string | number | boolean>> | undefined,
    content: unknown
  ): void
}>
