/** One native Host owns its transport and every connected call through the canonical endpoint. */
export { createRpcHost } from './host/create-rpc-host.js'
export type { IRpcHost, IRpcHostOptions, IRpcHostNotifyOptions } from './host/types.js'
/** Stable error identities and predicates let applications handle failures without a second factory. */
export {
  RpcCoreErrorCode,
  RpcLifecycleError,
  isRpcError,
  isRpcErrorInstance,
  isRpcRemoteError,
  isRpcTimeoutError,
  RPC_CORE_ERROR_SOURCE
} from './core/errors.js'
export type {
  RpcError,
  RpcSchemaValidationError,
  RpcConfigurationError,
  RpcConstructionError,
  RpcSerializationError,
  RpcProtocolError,
  RpcContractError,
  RpcTransportError,
  RpcAuthenticationError,
  RpcChunkError,
  RpcRemoteError,
  RpcAbortError,
  RpcTimeoutError,
  IRpcCoreErrorCode,
  IRpcError,
  IRpcCleanupError
} from './core/errors.js'
export { RpcProviderRejectionReason } from './core/semantic-constants.js'
export type { IRpcProviderRejection } from './core/provider-admission.js'
export type {
  IRpcContext,
  IRpcAuthenticationCapability,
  IRpcAuthenticationConfig,
  IRpcAuthenticationContext,
  IRpcFanoutResult,
  IRpcIdempotencyConfig,
  IRpcProviderLimits
} from './core/typing.js'
/** Provider policy may borrow one application-owned idempotency store and diagnostic sink. */
export { createRpcIdempotencyStore } from './core/idempotency-store.js'
export type {
  IRpcIdempotencyClaim,
  IRpcIdempotencyOutcome,
  IRpcIdempotencyStore
} from './core/idempotency-store.js'
export { defaultRpcReporter } from './core/default-reporter.js'
