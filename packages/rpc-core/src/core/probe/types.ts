import type { IRpcProbeStageName, RpcProbeStage } from './constants.js'

/** Fixed-shape mutable view reused by one emitter; valid only during its synchronous emit call. */
export type IRpcProbeEventView = {
  /** Emitter-local observation sequence; copy the view before retaining it. */
  seq: number
  /** Inbound physical carrier sequence carried through this frame; -1 means no carrier link. */
  carrierSeq: number
  /** Observation time in the owning endpoint scheduler's monotonic domain. */
  at: number
  /** Endpoint producing the observation. */
  endpointId: string
  /** Numeric RpcProbeStage ordinal for the observing pipeline layer. */
  stage: number
  /** Numeric outbound, inbound or local direction ordinal. */
  direction: number
  /** Numeric interaction-kind ordinal, not a wire discriminator. */
  kind: number
  /** Numeric progress, admission or settlement outcome ordinal. */
  outcome: number
  /** Logical correlation identifier when known at this stage. */
  messageId: string | undefined
  /** Application method when available at this stage. */
  method: string | undefined
  /** Original variation route name on message/envelope observations; absent on other stages. */
  variation: string | undefined
  /** Direct sender identity when known. */
  senderId: string | undefined
  /** Logical target identity when known. */
  targetId: string | undefined
  /** Selected receiver identity when known. */
  receiverId: string | undefined
  /** Carrier peer identity when available. */
  peerId: string | undefined
  /** Explicit caller correlation value, when supplied. */
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
  /** Admission refusal reason, when this observation records one. */
  rejection: string | undefined
  /** Lifecycle observation name, when present. */
  lifecycle: string | undefined
  /** Original local diagnostic reference; snapshots do not clone it. */
  error: unknown
  /** Physical carrier label when this stage observes one. */
  carrier: string | undefined
  /**
   * Stage-specific scalar diagnostics; borrowed references remain valid only as documented by their
   * owner.
   */
  detail: Readonly<Record<string, string | number | boolean>> | undefined
  /** Present only for captured stages, after the owning emitter applies redaction. */
  content: unknown
}

/** Cold endpoint capabilities describe which stages can actually produce observations. */
export type IRpcProbeDescriptor = Readonly<{
  /** Endpoint this cold capability description belongs to. */
  endpointId: string
  /** Configured physical platform label. */
  platform: string
  /** Declared exclusive, multiplexed or broadcast topology, when known. */
  topology?: string
  /** Selected physical representation label, when declared. */
  encodedType?: string
  /** Installed protection mode: none, sign or encrypt-sign. */
  authentication: 'none' | 'sign' | 'encrypt-sign'
  /** Whether this actual composition selected Core's direct processing path. */
  fastPath: boolean
  /** Available physical observer label, or unavailable when the carrier exposes none. */
  carrier: string | 'unavailable'
  /** Bit mask of stages this actual endpoint can emit. */
  stageMask: number
}>

/** Definition-time options compile once; capture is opt-in and initially a subset of stages. */
export type IRpcProbeDefinition = Readonly<{
  /** Required nonempty initial list of peer/message/envelope/encoded/frame/protected/carrier stages. */
  stages: readonly IRpcProbeStageName[]
  /** Optional payload-capture stages; defaults to none and must be a subset of stages. */
  capture?: readonly IRpcProbeStageName[]
  /** Optional synchronous payload projection applied before captured content reaches emit. */
  redact?(stage: RpcProbeStage, content: unknown): unknown
  /** Filters method-bearing logical/envelope events; methodless variation controls remain visible. */
  methods?: readonly string[]
  /** Deterministic sampling fraction greater than zero and at most one; defaults to one. */
  sample?: number
  /** Optional synchronous cold callback receiving the actual endpoint capabilities. */
  describe?(descriptor: IRpcProbeDescriptor): void
  /** Synchronous observation callback; copy fields to retain a reused live view. */
  emit(view: IRpcProbeEventView): void
  /** Optional diagnostic callback for probe failures; business operations retain their own result. */
  onError?(error: unknown): void
}>

/**
 * Frozen public handle retains compiled filters while private stage updates can pause or resume it.
 * Standalone stageMask is a getter; a host's data field retains its initial compiled mask. Emitters
 * read private state once at installation and use their own fixed-shape records thereafter.
 */
export type IRpcProbe = Readonly<{
  /**
   * Current stage bits on a standalone handle; an attached host data field retains its initial
   * mask.
   */
  readonly stageMask: number
  /** Immutable payload-capture mask compiled at definition. */
  readonly captureMask: number
  /** Compiled logical method filter; undefined admits all method names. */
  readonly methods: ReadonlySet<string> | undefined
  /** 0xffffffff means all events; other values compare against the unsigned sample key. */
  readonly sampleThreshold: number
  /** An empty list pauses the probe; validation failures leave the previous mask unchanged. */
  setStages(stages: readonly IRpcProbeStageName[]): void
}>

/** Transport capability receives physical observations without owning the endpoint emitter. */
export type IRpcCarrierProbe = Readonly<{
  /** Whether the physical adapter should supply content for this installation. */
  readonly capturing: boolean
  /**
   * Emit one synchronous physical observation using the adapter's actual direction, size and
   * carrier facts.
   */
  emit(
    direction: number,
    sizeBytes: number,
    carrier: string,
    detail: Readonly<Record<string, string | number | boolean>> | undefined,
    content: unknown
  ): void
}>
