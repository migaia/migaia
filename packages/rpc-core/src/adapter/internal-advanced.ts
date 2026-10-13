/** Native adapters retain only the existing lower-level operations their real source owners use. */
export { resolveAdapterEntry, retainAdapterRuntimeFlags } from '../runtime-adapter/entry.js'
export {
  createAdapterJsonRpcChannel,
  createJsonRpcBridgeError,
  JsonRpcProfile,
  JsonRpcErrorNumber,
  JSONRPC_REQUIRED_CAPABILITIES,
  JSONRPC_ALLOWED_CAPABILITIES,
  JSONRPC_REQUIRED_METHODS
} from '../runtime-adapter/jsonrpc/index.js'
export type { IAdapterJsonRpcChannelOptions } from '../runtime-adapter/jsonrpc/index.js'
export {
  createAdapterSourceConfigurationError,
  IpcReporterContext,
  createAdapterId,
  readAdapterAbortReason,
  validateAdapterPeerTimeout,
  validateAdapterPeerMethods,
  createAdapterConfigurationError,
  createAdapterConfigurationTypeError,
  createAdapterTransportError
} from '../runtime-adapter/data.js'
export { holdAdapterLaunch } from '../runtime-adapter/peer.js'
export type { IAdapterPeerPreparation } from '../runtime-adapter/peer.js'
export {
  createAdapterBindingDrain,
  createAdapterPlugin,
  holdAdapterRegistration
} from '../runtime-adapter/binding.js'
export type {
  IAdapterListenerPreparation,
  IAdapterListenerSession,
  IAdapterListenerService
} from '../runtime-adapter/listener.js'
export type { IRuntimeObjectConnection } from '../runtime-adapter/object/types.js'
export { createRuntimeByteConnection } from '../runtime-adapter/byte/handshake.js'
export { readRuntimeByteBootstrap } from '../runtime-adapter/byte/bootstrap.js'
export type {
  IRuntimeByteDiagnostics,
  IRuntimeConnectionOptions,
  IRuntimeByteOptions,
  IRuntimeByteConnection
} from '../runtime-adapter/byte/types.js'
export { createRuntimeProviderGovernor } from '../runtime-adapter/provider/governor.js'
export type { IRuntimeProviderGovernor } from '../runtime-adapter/provider/governor.js'
export { createRuntimeProviderScope } from '../runtime-adapter/provider/scope.js'
export type { IRuntimeProviderScope } from '../runtime-adapter/provider/scope.js'
export {
  createEventEmitterMessageResource,
  createEventTargetMessageResource
} from '../runtime-adapter/message/resource.js'
export type {
  IAdapterMessageResource,
  IAdapterEventEmitterMessagePort
} from '../runtime-adapter/message/types.js'
export { createRuntimeEventByteIO } from '../runtime-adapter/byte/event-byte-io.js'
export { createRuntimeMessageConnection } from '../runtime-adapter/message/connection.js'
/** Task capture and canonical assembly preserve genuine native source and Host ownership. */
export { captureAdapterTask, assembleAdapterPlugin } from '../runtime-adapter/definition.js'
export type { IAdapterTask, IAdapterTaskOptions } from '../runtime-adapter/definition-types.js'

/** Shared physical metadata sizing avoids payload scans or duplicate carrier implementations. */
export { carrierSizeBytes } from '../core/adapters/probe-content.js'
