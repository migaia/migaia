import type { RpcProviderRejectionReason } from './semantic-constants.js'

/** Existing local identities associated with one refused provider execution. */
export type IRpcProviderRejection = Readonly<{
  verifiedPeerKey: string
  controllerKey: string
  method: string
  reason: RpcProviderRejectionReason
}>
