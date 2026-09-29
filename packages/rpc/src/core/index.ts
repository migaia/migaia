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
  RpcError,
  RpcSchemaValidationError,
  RpcConfigurationError,
  RpcConstructionError,
  RpcLifecycleError,
  RpcSerializationError,
  RpcProtocolError,
  RpcContractError,
  RpcTransportError,
  RpcAuthenticationError,
  RpcChunkError,
  RpcRemoteError,
  RpcAbortError,
  RpcTimeoutError,
  isRpcError,
  RPC_CORE_ERROR_SOURCE
} from './errors.js'
export type { IRpcCoreErrorCode, IRpcError, IRpcCleanupError } from './errors.js'
export type { IRpcTransport, IRpcSendOptions, IRpcTransportTopology } from './transport.js'
export {
  createRpcIdempotencyStore,
  type IRpcIdempotencyClaim,
  type IRpcIdempotencyOutcome,
  type IRpcIdempotencyStore
} from './idempotency-store.js'
export * from './middleware/index.js'
