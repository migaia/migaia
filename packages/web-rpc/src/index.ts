/** Public runtime-neutral API for bidirectional web-rpc endpoints. */
export { createFullEndpoint as createEndpoint, createFullEndpoint } from './full.js'
export {
  defineFeature,
  type IWebRpcFeature,
  type IWebRpcFeatureDefinition,
  type IWebRpcFeatureSurface
} from './feature.js'
export {
  defineMiddleware,
  type IWebRpcMiddlewareCore,
  type IWebRpcMiddlewareDescriptor,
  type IWebRpcNativeMiddleware
} from './middleware.js'
export type * from './typing.js'
export * from './transport-constants.js'
export {
  WebRpcErrorCode,
  WebRpcError,
  WebRpcSchemaValidationError,
  WebRpcConfigurationError,
  WebRpcConstructionError,
  WebRpcLifecycleError,
  WebRpcSerializationError,
  WebRpcProtocolError,
  WebRpcContractError,
  WebRpcTransportError,
  WebRpcAuthenticationError,
  WebRpcChunkError,
  WebRpcRemoteError,
  WebRpcAbortError,
  WebRpcTimeoutError,
  isWebRpcError,
  WEBRPC_SOURCE
} from './errors.js'
export type { IWebRpcErrorCode, IWebRpcError, IWebRpcCleanupError } from './errors.js'
export {
  serializeError,
  deserializeError,
  reachError,
  type ISerializedError
} from './error-serialization.js'
export type { IWebRpcTransport, IWebRpcSendOptions, IWebRpcTransportTopology } from './transport.js'
export * from './middleware/index.js'
