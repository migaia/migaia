/** Stable error source owned by the runtime-neutral RPC contract layer. */
export const ERROR_SOURCE = '@migaia/rpc/contract'

/** Public error codes owned by the runtime-neutral RPC contract layer. */
export const RpcContractErrorCode = {
  /** Invalid descriptor identity or shape; caller must correct the component configuration. */
  invalidDescriptor: 'INVALID_DESCRIPTOR',
  /** Invalid semantic envelope; caller must reject the untrusted message. */
  invalidEnvelope: 'INVALID_ENVELOPE',
  /** Invalid frame grammar; caller must discard the frame sequence. */
  invalidFrame: 'INVALID_FRAME',
  /** Reassembly exceeded a declared message/source/global budget. */
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
