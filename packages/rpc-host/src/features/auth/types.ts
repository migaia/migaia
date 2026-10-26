/**
 * Declares authentication transforms, credentials and bounded request-replay configuration. These
 * runtime-neutral contracts lend admitted flow facts and shared refusal data; installed auth owns
 * mutable replay state while native transports supply real credential/source facts.
 */
import type { IRpcFlowContext, IRpcAuthenticationRetain } from '@migaia/rpc-contract/interfaces'
import type { IRpcPeerInfo, IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import type { IRpcProviderRejection } from '@migaia/rpc-contract/errors'

/** Authentication transforms receive host-admitted physical facts, never a Peer facade. */
export type IRpcAuthenticationTransform = (
  value: unknown,
  context: IRpcFlowContext
) => unknown | Promise<unknown>
/** Only the configured resolver receives private material from its exact native connection. */
export type IRpcAuthenticationCredentialsContext = IRpcFlowContext &
  Readonly<{ credentials?: IRpcPortableValue }>
/** A native owner resolves credentials from its exact carrier, never decoded self or payload fields. */
export type IRpcAuthenticationCredentials = (
  context: IRpcAuthenticationCredentialsContext
) => IRpcPortableValue | undefined | Promise<IRpcPortableValue | undefined>
/** The original paired-transform contract remains independent from native handshake credentials. */
export type IRpcAuthenticationOptions = Readonly<{
  encrypt?: IRpcAuthenticationTransform
  decrypt?: IRpcAuthenticationTransform
  sign?: IRpcAuthenticationTransform
  verify?: IRpcAuthenticationTransform
  /** Default any signs the binding object without encrypt; explicit text/bytes encode it once. */
  encodedType?: 'any' | 'string' | 'uint8array'
  /** Completed IDs release immediately by default; connection retain overrides this installation. */
  retain?: IRpcAuthenticationRetain
  /** Numeric retention alone reserves up to1024 active/retained IDs per admitted direct peer. */
  maxReplayEntriesPerPeer?: number
  /** Replay capacity refusal borrows the original admitted-identity diagnostic contract. */
  onRejected?(rejection: IRpcProviderRejection): void | Promise<void>
  credentials?: IRpcPortableValue | IRpcAuthenticationCredentials
  /**
   * Return an explicit {principalId: nonemptyString} to lend authenticated identity to this
   * Session. Other formerly ignored returns remain ignored; throwing or rejection refuses
   * credentials.
   */
  verifyCredentials?(
    auth: IRpcPortableValue | undefined,
    peer: IRpcPeerInfo,
    context: IRpcFlowContext
  ): unknown | Promise<unknown>
}>
/** One fixed 64-bit window belongs only to one actual inbound physical source. */
export type IAuthenticationCounterWindow = { nonce: string; high: bigint; bits: BigUint64Array }
/** This original signed wrapper is private auth data, independent from the RPC semantic profile. */
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
