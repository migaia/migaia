import type { IRpcAuthenticationCapability, IRpcAuthenticationContext } from '../typing.js'
import { RpcAuthenticationError, RpcConfigurationError } from '../errors.js'
import { RpcMiddlewareErrorText } from '../middleware/error-text.js'
import { RpcCoreErrorText } from '../error-text.js'
import { RpcEnvelopeKind, RpcRouteType, type IRpcEnvelope } from '../../contract/index.js'
import { RpcAuthenticationRejectionReason } from '../error-code.js'

/** Signed control discriminants are private authentication facts, outside RPC business routes. */
export const RpcAuthenticationControl = {
  /** Private proof defers initial discovery validation until the original framer completes. */
  query: 'discovery-query',
  /** The existing discovery response carries receiver-issued freshness without another round trip. */
  response: 'discovery-response',
  /** An unknown challenge invalidates the sender cache and never requests business replay. */
  unknown: 'session-unknown'
} as const

/** Optional signed facts appear only on non-exclusive, physically source-less carriers. */
export type IAuthenticationChallengeFields = {
  /** Session-unknown references the rejected frame counter without allocating a business sequence. */
  readonly counter?: string
  readonly challenge?: string
  readonly receiverId?: string
  readonly replyChallenge?: string
  readonly replyReceiverId?: string
  readonly control?: (typeof RpcAuthenticationControl)[keyof typeof RpcAuthenticationControl]
  readonly echoNonce?: string
}

/** Receiver facts are supplied only by the physical owner after topology/source classification. */
export type IAuthenticationChallengeContext = {
  readonly receiverId: string
  readonly unknown: (nonce: string, counter: string) => void | Promise<void>
}

/** One installed authentication owner supplies challenge freshness to existing discovery. */
export type IAuthenticationChallengePort = {
  /** Only privately admitted challenge facts require a per-frame outbound context. */
  readonly contextNeeded: (frame: IRpcEnvelope) => boolean
  readonly issue: (nonce: string) => string
  readonly needed: (receiverId: string) => boolean
  readonly remember: (
    receiverId: string,
    nonce: string,
    challenge: string,
    reverse?: boolean,
    targetId?: string
  ) => void
  readonly release: (receiverId: string) => void
  readonly forget: (receiverId: string, nonce: string) => void
  readonly outgoing: (receiverId: string) => { nonce: string; challenge: string } | undefined
}

/** Signed inbound facts follow the exact verified frame into its original semantic owner. */
export type IAuthenticationChallengeProof = IAuthenticationChallengeFields & {
  readonly nonce: string
}

/** Only the receiver owner can associate a transform context with a physical session. */
const contexts = new WeakMap<
  object,
  {
    session?: object
    active?: () => boolean
    challenge?: IAuthenticationChallengeContext
    frame?: IRpcEnvelope
    receiverId?: string
    fields?: IAuthenticationChallengeFields
  }
>()
/** Successful physical binding is carried to canonical semantic envelopes after decoding. */
const verifiedContexts = new WeakMap<object, IAuthenticationChallengeProof | true>()
/** Envelope identity supplies provider admission with a private, unforgeable binding fact. */
const verifiedEnvelopes = new WeakMap<object, IAuthenticationChallengeProof | true>()
/** Internal counter injection permits exact uint64 boundary cases without public options. */
const counterSetters = new WeakMap<
  object,
  {
    setter: (counter: bigint) => void
    challenge?: IAuthenticationChallengePort
  }
>()
/** Only locally created counter exhaustion may retain INVALID_CONFIG through sender wrapping. */
const counterErrors = new WeakSet<object>()

/** A verified control or frame for another broadcast receiver never reaches semantic decode. */
export const consumedAuthenticationFrame = Object.freeze({})

/** Canonical 64-bit counter state is shared by original physical and receiver challenge sessions. */
export type IAuthenticationCounterWindow = { high: bigint; bits: BigUint64Array }

/** SIEVE queue links belong to the same bounded nonce/window entry, never a second registry. */
export type IAuthenticationChallengeSession = IAuthenticationCounterWindow & {
  readonly nonce: string
  readonly challenge: string
  visited: boolean
  older?: IAuthenticationChallengeSession
  newer?: IAuthenticationChallengeSession
  replyReceiverId?: string
  replyChallenge?: string
  replyTargetId?: string
}

/** Commits one verified counter synchronously, preserving the original out-of-order window. */
export function admitAuthenticationCounter(
  state: IAuthenticationCounterWindow,
  sequence: bigint
): void {
  if (sequence > state.high) {
    const advance = sequence - state.high
    state.bits[0] = (advance >= 64n ? 0n : state.bits[0]! << advance) | 1n
    state.high = sequence
  } else {
    const distance = state.high - sequence
    if (distance >= 64n || (state.bits[0]! & (1n << distance)) !== 0n)
      throw new RpcAuthenticationError(RpcMiddlewareErrorText.authenticationFrameReplayed)
    state.bits[0] = state.bits[0]! | (1n << distance)
  }
}

/** Refines the existing authentication error without introducing a top-level error code. */
export function authenticationChallengeRejection(
  reason: RpcAuthenticationRejectionReason
): RpcAuthenticationError {
  /** The original error type/source/code and stack survive reason attachment. */
  const error = new RpcAuthenticationError(
    reason === RpcAuthenticationRejectionReason.sessionUnknown
      ? RpcCoreErrorText.authenticationSessionUnknown
      : RpcCoreErrorText.authenticationChallengeInvalid
  )
  Object.defineProperty(error, 'reason', { value: reason, enumerable: true })
  return error
}

/** Checks discovery semantics only after the original framer and codec have completed. */
export function assertAuthenticationChallengeEnvelope(
  context: IRpcAuthenticationContext,
  envelope: IRpcEnvelope
): void {
  /** Verified physical proof cannot be supplied by semantic payload fields. */
  const proof = verifiedContexts.get(context)
  if (!proof || proof === true || proof.control === undefined) return
  /** Complete semantic routing is validated before any identity/provider admission. */
  const route = envelope.data.route
  if (
    envelope.kind !== RpcEnvelopeKind.discovery ||
    route.targetId !== context.endpointId ||
    (proof.control === RpcAuthenticationControl.query
      ? route.type !== RpcRouteType.discoveryQuery
      : proof.control !== RpcAuthenticationControl.response ||
        route.type !== RpcRouteType.discoveryResponse ||
        (route.receiverId !== proof.receiverId &&
          !(route.manual && route.accepted === false && route.receiverId === undefined)))
  )
    throw authenticationChallengeRejection(RpcAuthenticationRejectionReason.challengeInvalid)
}

/** Uses the existing proof map for response metadata retained through canonical envelope creation. */
export function retainAuthenticationChallengeResponse(
  data: object,
  proof: IAuthenticationChallengeProof
): void {
  verifiedEnvelopes.set(data, proof)
}

/**
 * Creates the existing coded configuration error and records private ownership for sender
 * reporting.
 */
export function authenticationCounterExhaustion(): RpcConfigurationError {
  /** Exact error identity prevents an arbitrary transform error from claiming this exception. */
  const error = new RpcConfigurationError(RpcMiddlewareErrorText.authenticationCounterExhausted)
  counterErrors.add(error)
  return error
}

/** Sender preserves and reports only the allocator's genuine exhaustion error. */
export function isAuthenticationCounterExhaustion(error: unknown): boolean {
  return typeof error === 'object' && error !== null && counterErrors.has(error)
}

/** Binds a receiver-owned context; caller-visible context properties do not grant authority. */
export function bindAuthenticationReplayContext(
  context: IRpcAuthenticationContext,
  session: object,
  active: () => boolean = () => true,
  challenge?: IAuthenticationChallengeContext
): void {
  contexts.set(context, { session, active, challenge })
}

/** A late verification cannot revive the physical owner that supplied its context. */
export function authenticationReplaySession(
  context: IRpcAuthenticationContext
): object | undefined {
  /** Exact context ownership survives async verification without trusting user fields. */
  const binding = contexts.get(context)
  return binding?.active?.() ? binding.session : undefined
}

/** Reads only receiver-owned source-less proof, never public context shape. */
export function authenticationFrameContext(context: IRpcAuthenticationContext) {
  return contexts.get(context)
}

/** Captures one outbound semantic snapshot without mutating the stable transform context. */
export function bindAuthenticationOutboundFrame(
  context: IRpcAuthenticationContext,
  frame: IRpcEnvelope | undefined,
  receiverId: string,
  fields?: IAuthenticationChallengeFields
): void {
  contexts.set(context, { frame, receiverId, fields })
}

/** Records completed physical authentication before the receiver decodes any semantic member. */
export function recordAuthenticationReplayBinding(
  context: IRpcAuthenticationContext,
  proof?: IAuthenticationChallengeProof
): void {
  verifiedContexts.set(context, proof ?? true)
}

/** Transfers a successful whole-frame binding to a normalized member without another verification. */
export function markAuthenticationReplayEnvelope(
  context: IRpcAuthenticationContext,
  envelope: object
): void {
  const proof = verifiedContexts.get(context)
  if (proof) verifiedEnvelopes.set(envelope, proof)
}

/** Discovery consumes only metadata that survived the original physical authentication. */
export function readAuthenticationChallengeProof(
  envelope: object
): IAuthenticationChallengeProof | undefined {
  const proof = verifiedEnvelopes.get(envelope)
  return proof === true ? undefined : proof
}

/** Exact signed reply identity avoids selecting another client with the same logical sender id. */
export function authenticationReplyReceiverId(envelope: object): string | undefined {
  /** Original inbound admission must precede any response construction. */
  return readAuthenticationChallengeProof(envelope)?.replyReceiverId
}

/** Reads only private member identity; shape, metadata and frozen copies confer no proof. */
export function hasAuthenticationReplayBinding(envelope: object): boolean {
  return verifiedEnvelopes.has(envelope)
}

/** Keeps boundary injection confined to the package's internal test surface. */
export function registerAuthenticationCounterSetter(
  capability: IRpcAuthenticationCapability,
  setter: (counter: bigint) => void
): void {
  counterSetters.set(capability, { setter })
}

/** Joins challenge controls to the same installed capability registry used by counter ownership. */
export function registerAuthenticationChallengePort(
  capability: IRpcAuthenticationCapability,
  port: IAuthenticationChallengePort
): void {
  const owner = counterSetters.get(capability)!
  owner.challenge = port
}

/** Canonical discovery reads its installed authentication owner rather than another session table. */
export function readAuthenticationChallengePort(
  capability: IRpcAuthenticationCapability | undefined
): IAuthenticationChallengePort | undefined {
  return capability ? counterSetters.get(capability)?.challenge : undefined
}

/** Sets only a genuine installed capability's sequence for package boundary cases. */
export function setAuthenticationReplayCounter(
  capability: IRpcAuthenticationCapability,
  counter: bigint
): boolean {
  /** A copied or arbitrary capability has no mutable counter authority. */
  const setter = counterSetters.get(capability)
  if (!setter) return false
  setter.setter(counter)
  return true
}
