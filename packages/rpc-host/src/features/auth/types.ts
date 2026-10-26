/**
 * Keep authentication options runtime-neutral; transports supply connection facts and installed
 * flows own replay state.
 */
import type { IRpcFlowContext, IRpcAuthenticationRetain } from '@migaia/rpc-contract/interfaces'
import type { IRpcPeerInfo, IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import type { IRpcProviderRejection } from '@migaia/rpc-contract/errors'

/** Authentication transforms receive host-admitted physical facts, never a Peer facade. */
export type IRpcAuthenticationTransform = (
  value: unknown,
  context: IRpcFlowContext
) => unknown | Promise<unknown>
/** Expose connection-private credentials only to the configured resolver. */
export type IRpcAuthenticationCredentialsContext = IRpcFlowContext &
  Readonly<{ credentials?: IRpcPortableValue }>
/** Resolve credentials from the carrier, never decoded identity or payload fields. */
export type IRpcAuthenticationCredentials = (
  context: IRpcAuthenticationCredentialsContext
) => IRpcPortableValue | undefined | Promise<IRpcPortableValue | undefined>
/** Keep paired transforms independent from native handshake credentials. */
export type IRpcAuthenticationOptions = Readonly<{
  encrypt?: IRpcAuthenticationTransform
  decrypt?: IRpcAuthenticationTransform
  sign?: IRpcAuthenticationTransform
  verify?: IRpcAuthenticationTransform
  /** Default any signs the binding object without encrypt; explicit text/bytes encode it once. */
  encodedType?: 'any' | 'string' | 'uint8array'
  /** Completed IDs release immediately by default; connection retain overrides this installation. */
  retain?: IRpcAuthenticationRetain
  /** Bound numeric retention to at most 1024 active or retained IDs per admitted direct peer. */
  maxReplayEntriesPerPeer?: number
  /** Report replay-capacity refusal through the admitted-identity diagnostic contract. */
  onRejected?(rejection: IRpcProviderRejection): void | Promise<void>
  credentials?: IRpcPortableValue | IRpcAuthenticationCredentials
  /**
   * Only {principalId: nonemptyString} grants authenticated Session identity; other returns are
   * ignored, while failure refuses credentials.
   */
  verifyCredentials?(
    auth: IRpcPortableValue | undefined,
    peer: IRpcPeerInfo,
    context: IRpcFlowContext
  ): unknown | Promise<unknown>
}>
/** Isolate the 64-bit replay window to one inbound physical source. */
export type IAuthenticationCounterWindow = { nonce: string; high: bigint; bits: BigUint64Array }
/** Keep the signed replay wrapper independent from the RPC semantic profile. */
export type IAuthenticationEnvelope = Readonly<{
  authentication: string
  version: number
  nonce: string
  counter: string
  payload: unknown
}>

/** Each signed accept proves knowledge of this receiver's newly acquired source challenge. */
export type IAuthenticationHandshake = Readonly<{
  authentication: string
  version: number
  challenge: string
  replyChallenge?: string
  credentials?: IRpcPortableValue
}>
