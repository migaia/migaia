/** Stable error source owned by the runtime-neutral RPC contract layer. */
export const ERROR_SOURCE = '@migaia/rpc/contract'

/** Public error codes owned by the runtime-neutral RPC contract layer. */
export const RpcContractErrorCode = {
  /** Invalid descriptor identity or shape; caller must correct the component configuration. */
  invalidDescriptor: 'INVALID_DESCRIPTOR',
  /** Invalid semantic envelope; caller must reject the untrusted message. */
  invalidEnvelope: 'INVALID_ENVELOPE',
  /**
   * Invalid stream event, field, sequence, or value budget under streaming R3/R6/R8; reject this
   * frame and terminate only its stream.
   */
  invalidStream: 'INVALID_STREAM',
  /** Invalid frame grammar or empty/malformed physical batch; discard the physical frame. */
  invalidFrame: 'INVALID_FRAME',
  /** Reassembly or encoded physical batch exceeded its byte budget; split at member boundaries. */
  frameLimitExceeded: 'FRAME_LIMIT_EXCEEDED',
  /** Reassembly expired before all fragments arrived. */
  frameAssemblyExpired: 'FRAME_ASSEMBLY_EXPIRED',
  /** Invalid wire error payload; the caller must reject the received value under R4. */
  invalidWireError: 'INVALID_WIRE_ERROR',
  /** Malformed UTF-8, JSON, shape, or negotiation fields in a handshake; close this channel. */
  handshakeInvalid: 'HANDSHAKE_INVALID',
  /** No shared protocol identity or major version; the caller needs a compatible peer. */
  handshakeIncompatible: 'HANDSHAKE_INCOMPATIBLE',
  /** The remote peer rejected its handshake; inspect the preserved remote cause. */
  handshakeRejected: 'HANDSHAKE_REJECTED'
} as const

export type IRpcContractErrorCode = (typeof RpcContractErrorCode)[keyof typeof RpcContractErrorCode]
