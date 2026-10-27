/**
 * Describes the carrier and its codec boundary for the single RPC wire grammar. Transport packages
 * implement these resources; contract creates no connection, codec, or listener.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcErrorWireMetadata } from '../contract/types.js'
import type { IRpcNativeGeneration, IRpcTimeoutFeature } from './feature.js'
import type {
  IRpcOriginBinding,
  IRpcOriginHandle,
  IRpcPrivateSession,
  IRpcTargetSource
} from './origin.js'
import type { IRpcProbeDescriptor, RpcProbeDirection } from './observation.js'
import type {
  IRpcBinaryManifest,
  IRpcDirectory,
  IRpcGeneration,
  IRpcMethodDescription,
  IRpcPortableValue,
  IRpcSemanticFrame
} from '../wire/types.js'
import { RpcWireKind } from '../wire/constants.js'
import { RpcStreamEvent } from '../wire/stream-constants.js'

/** Native write admission reserves the original control lane independently from business data. */
export const IpcSendClass = { data: 'data', control: 'control' } as const
export type IpcSendClass = keyof typeof IpcSendClass

/** Trusted policy retirement facts remain local; the physical carrier owns error-code mapping. */
export const RpcSessionRetirement = {
  /** A quiet, ready connection reached its configured idle deadline. */
  idle: 'idle',
  /** The original runtime governor reached its violation or timeout liquidation threshold. */
  liquidated: 'liquidated'
} as const
/** Only explicit runtime policy producers can select these local retirement categories. */
export type RpcSessionRetirement = keyof typeof RpcSessionRetirement

/** Fixed semantic headers select local write facts without looking through an opaque codec frame. */
export function rpcCarrierWriteFacts(
  value: IRpcSemanticFrame
): Pick<IRpcCarrierWriteOptions, 'sendClass' | 'trace'> {
  /** Only result-bearing stream traffic shares the ordinary business-data lane. */
  const control =
    value.kind === RpcWireKind.handshake ||
    value.kind === RpcWireKind.directory ||
    value.kind === RpcWireKind.control ||
    value.kind === RpcWireKind.cancel ||
    value.kind === RpcWireKind.outcome ||
    (value.kind === RpcWireKind.stream &&
      value.stream.event !== RpcStreamEvent.item &&
      value.stream.event !== RpcStreamEvent.end &&
      value.stream.event !== RpcStreamEvent.fail)
  return {
    sendClass: control ? IpcSendClass.control : IpcSendClass.data,
    trace: 'route' in value ? value.route.trace : undefined
  }
}

/** Installation cleanup belongs to its actual transport or host owner. */
export type IRpcDispose = () => void | Promise<void>

/** Codec output remains opaque until the same physical carrier decodes it. */
export type IRpcCarrierFrame = Readonly<
  | {
      /** Ordinary encoded semantic traffic follows the selected codec. */
      kind: 'message'
      /** The carrier owns this representation and its physical packing. */
      data: unknown
      /** Native backings are borrowed original identities, never protocol-owned copies. */
      sidecars?: readonly ArrayBuffer[]
    }
  | {
      /** Only an installed, negotiated frame plugin handles this outer frame. */
      kind: 'extension'
      /** Versioned extension identity uses the negotiated name@version grammar. */
      extension: string
      /** Chunk or batch owns its private extension data shape. */
      data: unknown
      /** A frame plugin must preserve the sidecar identities it is carrying. */
      sidecars?: readonly ArrayBuffer[]
    }
>

/** Preparation exposes authenticated metadata before native values become business data. */
export type IRpcPreparedMessage = Readonly<{
  /** Prepared or protected metadata; only the actual codec restore admits a semantic frame. */
  message: unknown
  /** Optional binary representation supplied by the canonical carrier binary preparation. */
  manifest?: IRpcBinaryManifest
  /** The original complete backing list used by native transfer and integrity verification. */
  sidecars: readonly ArrayBuffer[]
}>

/** A Session supplies negotiated facts; caller options cannot create native transfer authority. */
export type IRpcCodecContext = Readonly<{
  /** Actual host-owned provenance accompanies pure admission; wire source/code never create it. */
  errorMetadata?: IRpcErrorWireMetadata
  /** Selected codec id from the accepted handshake. */
  codec: string
  /** True only for a physical carrier that can carry original native backings. */
  nativeBinary: boolean
  /** Local signing policy requires native backing integrity; peer metadata cannot enable it. */
  transferRequiresIntegrity?: boolean
  /** Actual carrier frame ceiling, enforced before allocation or physical write. */
  maxFrameBytes: number
  /** Only these explicit original backings may be transferred by the physical writer. */
  transfer?: readonly ArrayBuffer[]
}>

/**
 * Carriers reuse the existing prepare/restore algorithms. Envelope hooks authenticate prepared
 * metadata between preparation and encoding, and between decoding and restoration.
 */
export type IRpcCarrierCodec = Readonly<{
  /** Capture binary shape once while retaining original buffers and business key order. */
  prepare(
    message: IRpcSemanticFrame,
    context: IRpcCodecContext
  ): IRpcPreparedMessage | Promise<IRpcPreparedMessage>
  /** Produce the selected codec representation after outbound envelope hooks finish. */
  encode(
    message: IRpcPreparedMessage,
    context: IRpcCodecContext
  ): IRpcCarrierFrame | Promise<IRpcCarrierFrame>
  /** Decode protected metadata without exposing unauthenticated binary business values. */
  decode(
    frame: IRpcCarrierFrame,
    context: IRpcCodecContext
  ): IRpcPreparedMessage | Promise<IRpcPreparedMessage>
  /** Restore admitted native values only after inbound envelope hooks accept their metadata. */
  restore(
    message: IRpcPreparedMessage,
    context: IRpcCodecContext
  ): IRpcSemanticFrame | Promise<IRpcSemanticFrame>
}>

/** The carrier delivers already separated physical frames, never raw socket chunks. */
export type IRpcCarrierReceiver = Readonly<{
  /** Deliver one frame in carrier order; the host owns semantic processing. */
  frame(frame: IRpcCarrierFrame): void
  /** Report terminal physical closure once to its Session owner. */
  close(reason?: unknown): void
  /** Report a physical failure without silently swallowing the original value. */
  error(error: unknown): void
}>

/** A queued batch member borrows the existing native queue's exact cancellation registration. */
export type IRpcWriteQueueGuard = (
  cancelQueued?: (reason: unknown) => void
) => (() => void) | undefined

/** One logical write borrows capacity until all of its actual physical work has settled. */
export type IRpcWriteAdmission = Readonly<{
  /** Native queue shutdown can withdraw a member that has not reached its physical flush. */
  guard?: IRpcWriteQueueGuard
  /** The original capacity owner releases this logical write once; repeated release is harmless. */
  release(): void
}>

/** Local send authority is separate from the serialized physical frame. */
export type IRpcCarrierWriteOptions = Readonly<{
  /** Session freezes this flag only for a keepalive write admitted while that Session is closing. */
  keepalive?: boolean
  /** Session supplies the class before optional frame transformations; native IO never decodes it. */
  sendClass?: IpcSendClass
  /** Explicit caller correlation remains a local diagnostic fact, outside physical frame payloads. */
  trace?: string
  /** Explicit original backings retained until the physical write accepts them. */
  transfer?: readonly ArrayBuffer[]
  /** Cancellation before the actual write prevents that frame from leaving this carrier. */
  signal?: IAbortSignal
  /** Borrowed logical capacity follows every fragment or a coalesced physical write off the wire. */
  admission?: IRpcWriteAdmission
  /** Native IO invokes this immediately before physical handoff, never while locally queued. */
  onWriteStart?: () => void
}>

/** Actual native medium facts are supplied by the acquired carrier, never inferred from a frame. */
export type IRpcCarrierObservationFacts = Readonly<
  Pick<IRpcProbeDescriptor, 'platform' | 'topology' | 'encodedType'>
>

/** Raw content stays borrowed until the selected observer captures it synchronously before transfer. */
export type IRpcCarrierObservationEvent = Readonly<{
  direction: RpcProbeDirection
  content: unknown
  sizeBytes: number
  transfer?: readonly ArrayBuffer[]
  detail?: Readonly<Record<string, string | number | boolean>>
}>

/** One physical observation installation is independent of codec or message-flow intervention. */
export type IRpcCarrierObservation = Readonly<{
  facts: IRpcCarrierObservationFacts
  subscribe(listener: (event: IRpcCarrierObservationEvent) => void): IRpcDispose
}>

/**
 * One physical connection owns native IO, its codec, and subscription cleanup. close is idempotent
 * and returns its one owned Promise; no request table or provider execution lives here.
 */
export type IRpcCarrier = Readonly<{
  /**
   * Native delivery can drop startup messages before the opposite listener is installed. Session
   * resends the initiator's original hello once after its first peer hello on this medium.
   */
  startupMessagesMayBeLost?: true
  /** The acquired native medium permits writes until Session completes its bounded closing phase. */
  closingWrites?: true
  /** Only the actual transport maps trusted policy retirement to its own native error domain. */
  mapRetirement?(kind: RpcSessionRetirement, error: unknown): unknown
  /**
   * Borrow the native owner's terminal facts after a physical failure. Session joins this promise
   * only within its existing closing budget; a medium that remains alive cannot delay close
   * forever.
   */
  terminalReason?(): Promise<unknown>
  /**
   * Session sets the accepted inbound byte budget before sending accept. Byte carriers start at 64
   * KiB and apply this limit to length framing and JSON parsing; other media may omit this port.
   */
  setInboundFrameLimit?(maxFrameBytes: number): void
  /** Only an actual raw native observer can advertise carrier-stage capability. */
  observation?: IRpcCarrierObservation
  /** Native storage and transferable handoff differ; reject unsupported explicit transfer here. */
  assertTransfer(signed?: boolean): void
  /** Local connection identity isolates otherwise equal call ids from unrelated physical sources. */
  id: string
  /** Ordered codec proposals; JSON is the common startup codec. */
  codecs: readonly string[]
  /** Physical support for original native buffers, independent of remote proposals. */
  nativeBinary: boolean
  /** This carrier owns all executing media codec operations. */
  codec: IRpcCarrierCodec
  /** Install the host receiver and return the exact listener cleanup for this binding. */
  subscribe(receiver: IRpcCarrierReceiver): IRpcDispose
  /** Resolve only once the physical write accepts the frame, rather than when merely queued. */
  write(frame: IRpcCarrierFrame, options?: IRpcCarrierWriteOptions): void | Promise<void>
  /** Optional native capacity is reserved once before frame transformations, without a second queue. */
  reserveWrite?(options?: IRpcCarrierWriteOptions): IRpcWriteAdmission | undefined
  /** Close physical resources and settle every carrier-owned queued operation. */
  close(reason?: unknown): Promise<void>
}>

/** Readonly accepted metadata provides no mutable access to SessionTable or CallTable. */
export type IRpcSessionView = Readonly<{
  /** Dispatch samples the original native reader query, never a cached handshake qualification. */
  isExclusive?(): boolean
  /** A genuine native source may retain its existing complete execution-wall timeout. */
  callTimeoutCap?: IRpcTimeoutFeature
  /** Verified local authentication and the actual acquired Session identity remain off the wire. */
  authentication?: Readonly<{ principalId: string; sessionId: string }>
  /** Direct accepted node identity is descriptive loop information, never native authority. */
  nodeId?: string
  /** Host-local transport namespace; it never comes from application payload metadata. */
  namespace: string
  /** Accepted direct instance address within this namespace. */
  peerId: string
  /** Accepted display/forwarding name, distinct from instance identity. */
  name: string
  /** Generation supplied by the actual accepted session or restart owner. */
  generation: IRpcGeneration
  /** Host compiles method lookup once, so consumers never scan a directory per call. */
  methods: ReadonlyMap<string, IRpcMethodDescription>
  /** Selected codec from the completed host-owned handshake. */
  codec: string
  /** Selected extension membership is compiled once for constant-time frame admission. */
  extensions: ReadonlySet<string>
}>

/** The SDK exposes session lifecycle without recreating a per-session request/notify facade. */
export type IRpcSessionHandle = Readonly<{
  /** Only a real received handshake rejection supplies this exact readiness-failure identity. */
  handshakeFailure?: Readonly<{ phase: 'handshake'; error: unknown }>
  /** Fulfilled only when the host handshake and directory admission succeed. */
  ready: Promise<IRpcSessionView>
  /** Settles after this session has released its pending work and carrier subscription. */
  closed: Promise<void>
  /** Idempotent lifecycle operation owned by this Session. */
  close(reason?: unknown): Promise<void>
}>

/** Native queries borrow the accepted view and its existing stable lifecycle handle together. */
export type IRpcAttachedSession = Readonly<{ handle: IRpcSessionHandle; view: IRpcSessionView }>

/** Existing supervisor health checks use a bounded host control exchange. */
export type IRpcPingOptions = Readonly<{
  /** False leaves the supervisor-owned deadline as the only health clock. */
  timeoutMs?: number | false
  /** Supervisor shutdown may cancel a pending health probe. */
  signal?: IAbortSignal
}>

/** Trusted native launch facts do not come from decoded business messages or carry auth tokens. */
export type IRpcLocalSourceFacts = Readonly<{
  /** Complete native wall protection remains local and cannot be granted through wire metadata. */
  callTimeoutCap?: IRpcTimeoutFeature
  /** An acquired native connection may already own a distinct stable session identifier. */
  sessionId?: string
  /** Query the original native source's current sole-reader ownership after subscription. */
  isExclusive?(): boolean
  /** Parent-assigned identity wins; an omitted name preserves the child's configured/default name. */
  self?: Readonly<{ name?: string; instanceId: string }>
  /** The actual SDK source owner supplies its restart/session generation fact. */
  generation?: IRpcGeneration
  /** A child handshake must match its actual bootstrap parent instance address. */
  expectedPeerId?: string
  /**
   * Borrow actual native readiness/leave observations; decoded wire generations confer no
   * authority.
   */
  nativeGeneration?: IRpcNativeGeneration
}>

/**
 * Completed request IDs release immediately, follow signed counters, or retain positive safe
 * milliseconds.
 */
export type IRpcAuthenticationRetain = false | 'window' | number

/** Trusted connection secrets stay with Session and never enter descriptive source facts. */
export type IRpcConnectionContext = Readonly<{
  /** Only the configured auth credential resolver receives this native connection's value. */
  credentials?: IRpcPortableValue
  /** This exact connection overrides the auth Feature's completed-request retention policy. */
  retain?: IRpcAuthenticationRetain
  /** The native bootstrap verifier may attest identity before application authentication runs. */
  authentication?: Readonly<{ principalId: string }>
}>

/** Explicit session/control methods give transports no business request facade. */
export type IRpcTransportContext = Readonly<{
  /** Namespace declared by this installed transport plugin. */
  namespace: string
  /** Installation shutdown is propagated to carrier preparation and accepted resources. */
  signal: IAbortSignal
  /** Native launch bootstrap borrows the one current host identity before creating its child. */
  self(): IRpcDirectory['self']
  /** Read the canonical namespace name/instance index without building a second native directory. */
  lookup(address: string): IRpcAttachedSession | undefined
  /**
   * Attach a direct or pool-logical carrier. Host is the one self identity owner: explicit self
   * must agree with real source facts; first default child facts may supply it, later facts must
   * agree. Pool member carriers remain outside SessionTable, and facts never include auth tokens.
   */
  attach(
    carrier: IRpcCarrier,
    localSourceFacts?: IRpcLocalSourceFacts,
    connection?: IRpcConnectionContext
  ): IRpcSessionHandle
  /** Private members use the same physical Session without entering public identity indexes. */
  openPrivateSession(
    carrier: IRpcCarrier,
    facts: IRpcLocalSourceFacts | undefined,
    source: IRpcTargetSource,
    changed?: () => void,
    connection?: IRpcConnectionContext
  ): IRpcPrivateSession
  /** Publish one local origin projection after its genuine native resources are ready. */
  attachOrigin(binding: IRpcOriginBinding): IRpcOriginHandle
  /** Retire exactly the returned session handle, preserving its own close Promise. */
  detach(handle: IRpcSessionHandle, reason?: unknown): Promise<void>
  /**
   * Resolve on healthy pong; negative pong, timeout, or closed session rejects the original coded
   * failure.
   */
  ping(handle: IRpcSessionHandle, options?: IRpcPingOptions): Promise<void>
  /** Announce drain with the supervisor's remaining grace budget, never a fresh full timeout. */
  drain(handle: IRpcSessionHandle, remainingMs: number): Promise<void>
  /** Carrier or cleanup failures stay observable with their original cause. */
  report(error: unknown): void
}>
