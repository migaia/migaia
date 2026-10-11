/**
 * A runtime/carrier adapter gives Core the ordered raw I/O it actually holds. Core constructs the
 * channel, negotiates its protocol and owns its exact trust facts; no registrar is public.
 */
export { createAdapterChannel } from './adapter-owned/process/handshake.js'
export type {
  IProcessMessageChannel,
  IProcessByteChannel,
  IProcessCommonOptions,
  IProcessByteOptions,
  IProcessMessageOptions,
  IProcessByteListener,
  IAuthenticatedProcessChannel,
  IProcessPendingByteConnection,
  IListenProcessByteChannel
} from './adapter-owned/process/types.js'

/** Receive framed bootstrap on held byte I/O and transfer the same decoder into this channel. */
export { receiveAdapterBootstrap } from './adapter-owned/process/bootstrap.js'

/** Adapter admission and presentation retain canonical owners without exposing trust writers. */
export {
  AdapterPeerErrorText,
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
export type { IAdapterRegistration } from './runtime-adapter/binding.js'
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
  IRuntimeBytePhysicalResource
} from './runtime-adapter/byte/event-byte-io.js'
