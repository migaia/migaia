import { ERROR_SOURCE } from './error-code.js'

/** Contract-layer identity attached to every RPC contract boundary error. */
export const RPC_CONTRACT_SOURCE = ERROR_SOURCE

/** Stable diagnostics for hostile RPC contract input and bounded framing. */
export const RpcContractErrorText = {
  invalidDescriptor: 'rpc descriptor is invalid',
  invalidEnvelope: 'rpc envelope is invalid',
  invalidFrame: 'rpc frame is invalid',
  frameLimitExceeded: 'rpc frame limit exceeded',
  frameAssemblyExpired: 'rpc frame assembly expired',
  /** Stable message for invalid wire error payloads reported by contract validation. */
  invalidWireError: 'rpc wire error is invalid',
  /** Public diagnostic for a handshake message that fails protocol 1.0 validation. */
  handshakeInvalid: 'rpc handshake is invalid',
  /** Public diagnostic when protocol identity or major versions cannot be negotiated. */
  handshakeIncompatible: 'rpc handshake is incompatible',
  /** Public diagnostic for a rejected remote handshake with its original cause retained. */
  handshakeRejected: 'rpc handshake was rejected'
} as const
