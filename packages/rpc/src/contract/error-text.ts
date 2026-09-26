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
  /**
   * Message used when a thrown non-Error value cannot be converted with `String()` (hostile
   * `toString`/`Symbol.toPrimitive`); keeps `serializeRpcError` total. Consumer: `error.ts`.
   */
  unstringifiableThrown: 'rpc thrown value is not stringifiable'
} as const
