/**
 * Defines runtime-neutral observation facts, borrowed probe views and fixed event vocabularies.
 * Pure envelope projections expose admitted header facts; subscriptions, capture and physical IO
 * belong to Host, SDK and concrete transport owners.
 */
import { RpcWireKind, RpcCallMode } from '../wire/constants.js'
import { RpcStreamEvent } from '../wire/stream-constants.js'
import type { IRpcEnvelope, IRpcControlFrame } from '../wire/types.js'
import type { IRpcCarrierFrame } from './carrier.js'
/** Physical platform labels move from the retired transport owner without changing their values. */
export const RpcCarrierPlatform = {
  /** Same-origin broadcast channel. */ broadcastChannel: 'BroadcastChannel',
  /** Window or frame postMessage. */ iframe: 'Iframe',
  /** Same-process reference delivery. */ memory: 'Memory',
  /** Acquired MessagePort. */ messagePort: 'MessagePort',
  /** Process IPC or native bytes. */ process: 'Process',
  /** Acquired RTC data channel. */ rtcDataChannel: 'RTCDataChannel',
  /** Acquired WebTransport stream. */ webTransport: 'WebTransport',
  /** Worker messaging. */ worker: 'Worker'
} as const

/** One acquired carrier's declared native representation, independent of semantic codec labels. */
export const RpcCarrierEncoding = {
  any: 'any',
  string: 'string',
  uint8Array: 'uint8array'
} as const

/** A physical source declares its actual selection topology at acquisition. */
export const RpcCarrierTopology = {
  exclusive: 'exclusive',
  multiplexed: 'multiplexed',
  broadcast: 'broadcast'
} as const

/** Stable stage ordinals keep Core dispatch numeric; name tables serve exported diagnostics. */
export const RpcProbeStage = Object.freeze({
  /** Endpoint lifecycle and admission observations. */ peer: 0,
  /** Logical application interactions. */ message: 1,
  /** Admitted semantic protocol envelopes. */ envelope: 2,
  /** Values after the selected codec. */ encoded: 3,
  /** Framer output and acceptance observations. */ frame: 4,
  /** Authentication-protected physical values. */ protected: 5,
  /** Actual native I/O observations when the adapter exposes them. */ carrier: 6,
  /** Each forwarding host's receive, handoff or rejection facts. */ forward: 7
} as const)

/** Numeric stage ordinal corresponding to RpcProbeStageName. */
export type RpcProbeStage = (typeof RpcProbeStage)[keyof typeof RpcProbeStage]

/** Stage names also define the configuration vocabulary accepted by defineProbe and setStages. */
export const RpcProbeStageName = Object.freeze(
  Object.keys(RpcProbeStage) as (keyof typeof RpcProbeStage)[]
)

/** Accepted configuration stage name from the stable stage-name table. */
export type IRpcProbeStageName = (typeof RpcProbeStageName)[number]

/** Direction ordinals distinguish physical traffic from endpoint-local lifecycle events. */
export const RpcProbeDirection = Object.freeze({
  /** Traffic leaving the endpoint. */ outbound: 0,
  /** Traffic entering the endpoint. */ inbound: 1,
  /** Owner-local lifecycle or admission observation. */ local: 2
} as const)

/** Numeric outbound, inbound or local observation direction. */
export type RpcProbeDirection = (typeof RpcProbeDirection)[keyof typeof RpcProbeDirection]

/** Export-time direction names correspond exactly to RpcProbeDirection ordinals. */
export const RpcProbeDirectionName = Object.freeze(
  Object.keys(RpcProbeDirection) as (keyof typeof RpcProbeDirection)[]
)

/** Interaction-kind ordinals cover logical calls, streams, control and lifecycle observations. */
export const RpcProbeKind = Object.freeze({
  /** Result-bearing scalar call. */ request: 0,
  /** Scalar reply. */ response: 1,
  /** Notification without a remote result. */ notify: 2,
  /** Stream creation. */ streamOpen: 3,
  /** Stream value delivery. */ streamChunk: 4,
  /** Stream terminal observation. */ streamClose: 5,
  /** Cancellation control. */ cancel: 6,
  /** Other protocol control traffic. */ control: 7,
  /** Endpoint or connection lifetime event. */ lifecycle: 8
} as const)

/** Numeric interaction-kind ordinal used in live probe views. */
export type RpcProbeKind = (typeof RpcProbeKind)[keyof typeof RpcProbeKind]

/** Export-time kind names correspond exactly to RpcProbeKind ordinals. */
export const RpcProbeKindName = Object.freeze(
  Object.keys(RpcProbeKind) as (keyof typeof RpcProbeKind)[]
)

/** Outcome ordinals distinguish progress, admission and settlement without string hot paths. */
export const RpcProbeOutcome = Object.freeze({
  /** No progress outcome applies. */ none: 0,
  /** Local work was created. */ created: 1,
  /** Local sending completed. */ sent: 2,
  /** An inbound value was observed. */ received: 3,
  /** The owner accepted the operation. */ admitted: 4,
  /** Admission refused the operation. */ rejected: 5,
  /** The operation completed normally. */ settled: 6,
  /** The observed operation failed. */ failed: 7
} as const)

/** Numeric progress or settlement outcome used in probe views. */
export type RpcProbeOutcome = (typeof RpcProbeOutcome)[keyof typeof RpcProbeOutcome]

/** Export-time outcome names correspond exactly to RpcProbeOutcome ordinals. */
export const RpcProbeOutcomeName = Object.freeze(
  Object.keys(RpcProbeOutcome) as (keyof typeof RpcProbeOutcome)[]
)

/** Readonly stage records are emitted by the actual owner through the one flow observer port. */
export const RpcProbeObservationKind = {
  /** A completed owner stage exposes borrowed facts without an intervention continuation. */
  event: 'probe-event',
  /** Only actual installed source facts may describe the available observer capabilities. */
  descriptor: 'probe-descriptor'
} as const

/** Forward refusals retain their actual owner reason independently of their public error code. */
export const RpcProbeForwardRejection = {
  /** The next route would revisit an already traversed node. */ loop: 'loop',
  /** This host's configured forwarding ceiling would be exceeded. */ hopLimit: 'hop-limit',
  /** No current target can be selected for this logical destination. */ targetUnknown:
    'target-unknown',
  /** The selected target does not publish the requested method or mode. */ methodUnavailable:
    'method-unavailable'
} as const
/** One observed forward refusal reason; it never grants execution or retry authority. */
export type RpcProbeForwardRejection =
  (typeof RpcProbeForwardRejection)[keyof typeof RpcProbeForwardRejection]

/** Existing public connection phases come from their actual Session transitions. */
export const RpcProbeLifecycle = {
  /** The physical subscription exists and the one handshake attempt is beginning. */
  handshake: 'handshake',
  /** Actual negotiated identity has been admitted and published by the Session owner. */
  ready: 'ready',
  /** The actual Session selected its terminal reason before releasing physical resources. */
  closing: 'closing'
} as const

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
  /** This host's forward ordinal, or -1 when the observation is not a forward fact. */
  hop: number
  /** This forwarding host's configured ceiling, or -1 when no such fact applies. */
  maxHops: number
  /** Traversed node ids borrowed only until this synchronous observation callback returns. */
  route: readonly string[] | undefined
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

/** Trusted owner facts contain no receiver sequence or local endpoint identity authority. */
export type IRpcProbeObservation = Readonly<
  Pick<IRpcProbeEventView, 'stage'> &
    Partial<Omit<IRpcProbeEventView, 'stage' | 'seq' | 'endpointId'>> &
    Readonly<{
      /** Actual physical transfer authority is borrowed only for direct captured byte preservation. */
      transfer?: readonly ArrayBuffer[]
      /** The observer may project physical metadata without decoding or replacing captured data. */
      carrierFrame?: IRpcCarrierFrame
    }>
>

/** Installed protection mode is supplied by the actual authentication owner at cold setup. */
export const RpcProbeAuthentication = {
  /** No installed transform claims protection. */ none: 'none',
  /** The real installed owner signs and verifies. */ sign: 'sign',
  /** The real installed owner also encrypts and decrypts. */ encryptSign: 'encrypt-sign'
} as const

/** Cold endpoint capabilities describe which stages can actually produce observations. */
export type IRpcProbeDescriptor = Readonly<{
  /** Endpoint this cold capability description belongs to; multi-carrier hosts keep this identity. */
  endpointId: string
  /**
   * Actual host-local namespace distinguishes physical source descriptions without changing
   * endpointId.
   */
  namespace?: string
  /** Exact native carrier identity scopes one successful Session publication. */
  carrierId?: string
  /** Configured physical platform label. */
  platform: string
  /** Declared exclusive, multiplexed or broadcast topology, when known. */
  topology?: string
  /** Selected physical representation label, when declared. */
  encodedType?: string
  /** Installed protection mode: none, sign or encrypt-sign. */
  authentication: (typeof RpcProbeAuthentication)[keyof typeof RpcProbeAuthentication]
  /** Present only when a real selected-path owner supplies it; retired v1 proof is not fabricated. */
  fastPath?: boolean
  /** Available physical observer label, or unavailable when the carrier exposes none. */
  carrier: string | 'unavailable'
  /** Bit mask of stages this actual endpoint can emit. */
  stageMask: number
}>

/** Project the original admitted compact task/header; metadata never grants execution authority. */
export function rpcProbeEnvelopeFacts(
  value: Pick<IRpcEnvelope, 'id' | 'route'> & Partial<Pick<IRpcEnvelope, 'task'>>
): Pick<
  IRpcProbeEventView,
  'messageId' | 'method' | 'senderId' | 'targetId' | 'receiverId' | 'trace' | 'hop' | 'route'
> {
  return {
    messageId: value.id,
    method: value.task?.method,
    senderId: value.route.senderId,
    targetId: value.route.targetId,
    receiverId: value.route.receiverId,
    trace: value.route.trace,
    hop: (value.route.forwardRoute?.length ?? 0) - 1,
    route: value.route.forwardRoute
  }
}

/** Reuse the original runtime kind projection against the single admitted profile grammar. */
export function rpcProbeEnvelopeKind(value: IRpcEnvelope | IRpcControlFrame): RpcProbeKind {
  if (value.kind === RpcWireKind.control) return RpcProbeKind.control
  if (value.kind === RpcWireKind.call)
    return value.task.mode === RpcCallMode.notify
      ? RpcProbeKind.notify
      : value.task.mode === RpcCallMode.stream
        ? RpcProbeKind.streamOpen
        : RpcProbeKind.request
  if (
    value.kind === RpcWireKind.group ||
    (value.kind === RpcWireKind.outcome && !('state' in value))
  )
    return RpcProbeKind.request
  if (value.kind === RpcWireKind.cancel) return RpcProbeKind.cancel
  if (value.kind === RpcWireKind.stream) {
    if (value.stream.event === RpcStreamEvent.open) return RpcProbeKind.streamOpen
    if (value.stream.event === RpcStreamEvent.item) return RpcProbeKind.streamChunk
    if (
      value.stream.event === RpcStreamEvent.end ||
      value.stream.event === RpcStreamEvent.fail ||
      value.stream.event === RpcStreamEvent.cancelled
    )
      return RpcProbeKind.streamClose
    return RpcProbeKind.control
  }
  return RpcProbeKind.response
}
