/**
 * Owns stable Contract diagnostic text shared by pure validators and native error construction.
 * Protocol admission and error provenance remain with their respective owners.
 */
import { ERROR_SOURCE } from '../error-code.ts'

/** Contract-layer identity attached to every RPC contract boundary error. */
export const RPC_CONTRACT_SOURCE = ERROR_SOURCE

/** Stable diagnostics for hostile RPC contract input and bounded framing. */
export const RpcContractErrorText = {
  /** Safe wire summary for an unclassified callback failure; the original stays locally reachable. */
  callbackFailed: 'rpc contract callback failed',
  invalidDescriptor: 'rpc descriptor is invalid',
  invalidEnvelope: 'rpc envelope is invalid',
  /** Stable diagnostic for a stream frame rejected by the contract validator. */
  invalidStream: 'rpc stream is invalid',
  invalidFrame: 'rpc frame is invalid',
  /** Preserves the original process string diagnostic at its canonical framing owner. */
  expectedString: 'process channel requires a string encoded value',
  frameLimitExceeded: 'rpc frame limit exceeded',
  frameAssemblyExpired: 'rpc frame assembly expired',
  /** Stable message for invalid wire error payloads reported by contract validation. */
  invalidWireError: 'rpc wire error is invalid',
  /** Public diagnostic for a handshake message that fails protocol 1.0 validation. */
  handshakeInvalid: 'rpc handshake is invalid',
  /** Public diagnostic when protocol identity or major versions cannot be negotiated. */
  handshakeIncompatible: 'rpc handshake is incompatible',
  /** Public diagnostic for a rejected remote handshake with its original cause retained. */
  handshakeRejected: 'rpc handshake was rejected',
  /** A locally required installed extension has no compatible accepted peer handler. */
  extensionNegotiationFailed: 'rpc extension negotiation failed'
} as const
