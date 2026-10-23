/** Public runtime-neutral API for bidirectional web-rpc endpoints. */
export {
  createFullEndpoint as createEndpoint,
  createFullEndpoint,
  createFullOneWayEndpoint
} from './full.js'
export {
  defineFeature,
  type IRpcFeature,
  type IRpcFeatureDefinition,
  type IRpcFeatureSurface
} from './feature.js'
export {
  defineMiddleware,
  type IRpcMiddlewareCore,
  type IRpcMiddlewareDescriptor,
  type IRpcNativeMiddleware
} from './middleware.js'
export type * from './typing.js'
export * from './transport-constants.js'
export {
  RpcCoreErrorCode,
  RpcLifecycleError,
  isRpcError,
  isRpcErrorInstance,
  isRpcRemoteError,
  isRpcTimeoutError,
  RPC_CORE_ERROR_SOURCE
} from './errors.js'
/** Diagnostic classes describe failures; only Core's private factories mint operation identity. */
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
} from './errors.js'
export { serializeRpcError, deserializeRpcError } from './internal/error-wire-metadata.js'
export { defaultRpcReporter } from './default-reporter.js'
export type { IRpcTransport, IRpcSendOptions } from './transport.js'
export {
  createRpcIdempotencyStore,
  type IRpcIdempotencyClaim,
  type IRpcIdempotencyOutcome,
  type IRpcIdempotencyStore
} from './idempotency-store.js'
export * from './middleware/index.js'

export { RpcProviderRejectionReason } from './semantic-constants.js'
export type { IRpcProviderRejection } from './provider-admission.js'

export { createRuntimeApiEndpoint } from './runtime-api-endpoint.js'
