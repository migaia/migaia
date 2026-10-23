import type { RpcProviderRejectionReason } from './semantic-constants.js'

/** Existing local identities associated with one refused provider execution. */
export type IRpcProviderRejection = Readonly<{
  /** Original verified-peer quota identity used for this local admission. */
  verifiedPeerKey: string
  /** Original invocation controller identity associated with the refusal. */
  controllerKey: string
  /** Requested application method that was not invoked. */
  method: string
  /**
   * Specific local quota/replay/binding reason; the wire OVERLOADED code alone does not distinguish
   * it.
   */
  reason: RpcProviderRejectionReason
}>
