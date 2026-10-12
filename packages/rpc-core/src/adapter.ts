/** Adapter admission and presentation retain canonical owners without exposing trust writers. */
/** The one JSON-RPC wire owner accepts only held bytes and local presentation operations. */
export {
  createAdapterJsonRpcChannel,
  createJsonRpcBridgeError,
  JsonRpcProfile,
  JsonRpcErrorNumber,
  JSONRPC_REQUIRED_CAPABILITIES,
  JSONRPC_ALLOWED_CAPABILITIES,
  JSONRPC_REQUIRED_METHODS
} from './runtime-adapter/jsonrpc/index.js'
export type {
  IAdapterJsonRpcChannelOptions,
  IAdapterJsonRpcChannelPresentation
} from './runtime-adapter/jsonrpc/index.js'
export {
  createAdapterSourceConfigurationError,
  IpcReporterContext,
  createAdapterId,
  readAdapterAbortReason,
  validateAdapterPeerTimeout,
  validateAdapterPeerMethods,
  normalizeAdapterDescription,
  adapterContractRequiresStream,
  createAdapterConfigurationError,
  createAdapterConfigurationTypeError,
  createAdapterTransportError
} from './runtime-adapter/data.js'
/** Opaque preparation retains original Host context across native resource acquisition. */
export { prepareAdapterPeer, holdAdapterLaunch } from './runtime-adapter/peer.js'
export type {
  IAdapterPeerOptions,
  IAdapterPeerPreparation,
  IAdapterManagedBinding
} from './runtime-adapter/peer.js'
/** Whole binding and registration operations reuse the remote lifecycle owner. */
export {
  createAdapterBindingDrain,
  createAdapterPlugin,
  holdAdapterRegistration
} from './runtime-adapter/binding.js'
export type {
  IAdapterRegistration,
  IAdapterBindingDrain,
  IAdapterPluginLifecycleResource
} from './runtime-adapter/binding.js'
/**
 * Listener resources retain genuine endpoint/session preparation without accepting context or
 * claims.
 */
export type {
  IAdapterListenerPreparation,
  IAdapterListenerSession,
  IAdapterListenerOwner,
  IAdapterListenerService
} from './runtime-adapter/listener.js'
/**
 * Byte Peer configuration is local presentation data, never decoded bootstrap or accepted
 * agreement.
 */
export type { IAdapterBytePeerOptions } from './runtime-adapter/byte/peer.js'
/** Object negotiation creates its own final transport and retains its own private agreement. */
export { holdAdapterObjectChannel, materializeAdapterJson } from './runtime-adapter/object/index.js'
export type {
  IRuntimeObjectIO,
  IRuntimeObjectChannel,
  IRuntimeObjectConnection
} from './runtime-adapter/object/types.js'
/** Held byte connections and bootstrap decoding keep all exact fact writers inside Core. */
export { createRuntimeByteConnection } from './runtime-adapter/byte/handshake.js'
export { readRuntimeByteBootstrap } from './runtime-adapter/byte/bootstrap.js'
export type {
  IRuntimeByteIO,
  IRuntimeByteDiagnostics,
  IRuntimeConnectionOptions,
  IRuntimeByteOptions,
  IRuntimeByteConnection
} from './runtime-adapter/byte/types.js'
/** Generic provider resource operations own reservation, wrapper, and authenticated scope identity. */
export { createRuntimeProviderGovernor } from './runtime-adapter/provider/governor.js'
export type {
  IRuntimeProviderPolicy,
  IRuntimeProviderGovernor
} from './runtime-adapter/provider/governor.js'
export { createRuntimeProviderScope } from './runtime-adapter/provider/scope.js'
export type { IRuntimeProviderScope } from './runtime-adapter/provider/scope.js'
/**
 * Message resources own actual ACK capture, component construction, and native lifetime
 * observations.
 */
export {
  createEventEmitterMessageResource,
  createEventTargetMessageResource
} from './runtime-adapter/message/resource.js'
export type {
  IAdapterEventEmitterMessagePort,
  IAdapterEventTargetMessagePort,
  IAdapterLaunchHandle,
  IAdapterInitialMessageResource,
  IAdapterStaticMessageOptions,
  IAdapterMessageOpenOptions,
  IAdapterMessageResource
} from './runtime-adapter/message/types.js'
/** Event byte observation remains generic; Node glue supplies the actual held stream resources. */
export { createRuntimeEventByteIO } from './runtime-adapter/byte/event-byte-io.js'
export type {
  IRuntimeEventByteReader,
  IRuntimeEventByteWriter,
  IRuntimeBytePhysicalResource,
  IRuntimeByteViewFactory
} from './runtime-adapter/byte/event-byte-io.js'
/** Held whole-message I/O expands its fixed V1 profile only through actual bounded ACK reception. */
export { createRuntimeMessageConnection } from './runtime-adapter/message/connection.js'
export type {
  IRuntimeMessageConnectionOptions,
  IRuntimeMessageDiagnostics
} from './runtime-adapter/message/connection.js'
export type { IRuntimeMessageIO } from './runtime-adapter/byte/types.js'
