/** Native RPC definitions are the public extension boundary for transports and optional features. */
export { defineFeaturePlugin, defineTransportPlugin } from './define.js'
export * from './types.js'
export type { IRpcHost } from '../host/types.js'
/** Assemblers reuse the same safe query formatter and default diagnostic sink. */
export { runtimeQuery } from '../remote/runtime-api/overview.js'
export { defaultRpcReporter } from '../core/default-reporter.js'
/** Existing authoring channels converge here while their original internal owners remain intact. */
export {
  RemoteMethodMode,
  REMOTE_NAME_PATTERN,
  REMOTE_METHOD_MAX_LENGTH,
  REMOTE_SCHEMA_VERSION,
  REMOTE_METHOD_MODES,
  normalizeRemoteContract,
  normalizeRemoteHostCatalog,
  normalizeRemoteControlShape,
  sameRemoteContract
} from '../remote/contract.js'
export { RemoteMethodName, DEFAULT_DRAIN_MS } from '../remote/constants.js'
export {
  RuntimePluginKey,
  RUNTIME_API_SCHEMA_VERSION,
  RuntimeApiMode,
  RuntimeConnectionDirection,
  RuntimeEventName,
  RuntimeQueryStatus,
  RuntimeSourceKind
} from '../remote/runtime-api/constants.js'
export {
  ERROR_SOURCE as RPC_REMOTE_ERROR_SOURCE,
  RpcRemoteLayerErrorCode
} from '../remote/error-code.js'
export { createRemoteRetryPort } from '../remote/retry.js'
export type {
  IRemoteChannel,
  IRemoteBinding,
  IRemoteServeEndpoint,
  IRemoteEndpointFactory,
  IRemoteCallOptions,
  IRemoteCallGuard,
  IRemoteGenerationEvents,
  IRemoteRetryDispatch,
  IRemoteRetryPort,
  IRemoteProxyOptions
} from '../remote/types.js'
export type {
  IRemoteMethodContract,
  IRemoteFeatureContract,
  IRemoteContract,
  IRemoteHostCatalog,
  IRemoteControlDefinition
} from '../remote/contract.js'
export type {
  IRuntimeSurface,
  IRuntimeDynamicSurface,
  IRuntimeTypedPeer,
  IRuntimeCallOptions,
  IRuntimeExpose,
  IRuntimeFlatten,
  IRuntimePluginTyping,
  IRuntimeRegistry
} from '../remote/runtime-api/typing.js'
export type { IRuntimePeerProvide } from '../remote/runtime-api/catalog.js'
export type {
  IRuntimePeerIdentity,
  IRuntimePeerDescription,
  IRuntimeMethodDescription
} from '../remote/runtime-api/description.js'
export type { IRuntimeEvent } from '../remote/runtime-api/events.js'
export type {
  IRuntimeListFilter,
  IRuntimeListOptions,
  IRuntimeProcessStopOptions,
  IRuntimeThreadStopOptions
} from '../remote/runtime-api/outlet.js'
export type {
  IRuntimeConnectionDetail,
  IRuntimeDetail,
  IRuntimeOverview,
  IRuntimeQueryOptions,
  IRuntimeRecent,
  IRuntimeUnavailable
} from '../remote/runtime-api/overview.js'
export type {
  IRuntimePeer,
  IRuntimePeerOptions,
  IRuntimePeerSource,
  IRuntimePeerSourceContext,
  IRuntimePeerSourceResult
} from '../remote/runtime-api/peer.js'
export type { IRpcRemoteLayerErrorCode } from '../remote/error-code.js'
/** Task-level adapter authors provide actual raw I/O; Core retains protocol and resource owners. */
export { defineMessageAdapter, defineByteAdapter } from '../runtime-adapter/definition.js'
export type {
  IMessageAdapterOptions,
  IMessageAdapterPort,
  IMessageAdapterLaunch,
  IByteAdapterOptions,
  IAdapterDefinition,
  IAdapterDeploymentOptions
} from '../runtime-adapter/definition-types.js'
/** Native adapters retain only the existing lower-level operations their real source owners use. */
export { resolveAdapterEntry, retainAdapterRuntimeFlags } from '../runtime-adapter/entry.js'
export { createJsonRpcBridgeError } from '../runtime-adapter/jsonrpc/error.js'
export {
  JsonRpcProfile,
  JsonRpcErrorNumber,
  JSONRPC_REQUIRED_CAPABILITIES,
  JSONRPC_ALLOWED_CAPABILITIES,
  JSONRPC_REQUIRED_METHODS
} from '../runtime-adapter/jsonrpc/constants.js'
export type { IAdapterJsonRpcChannelOptions } from '../runtime-adapter/jsonrpc/handshake.js'
export {
  createAdapterSourceConfigurationError,
  IpcReporterContext,
  createAdapterId,
  readAdapterAbortReason,
  createAdapterConfigurationError,
  createAdapterConfigurationTypeError,
  createAdapterTransportError
} from '../runtime-adapter/data.js'
export { holdAdapterLaunch } from '../runtime-adapter/peer.js'
export type { IAdapterPeerPreparation } from '../runtime-adapter/peer.js'
export { createAdapterBindingDrain } from '../runtime-adapter/binding.js'
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

/** Shared physical metadata sizing avoids payload scans or duplicate carrier implementations. */
export { carrierSizeBytes } from '../core/adapters/probe-content.js'
/** Public adapter-facing transport types. */
export type { IRpcTransport, IRpcSendOptions } from '../core/transport.js'
/** Stable platform and resource ownership values for adapters. */
export { RpcPlatform, RpcTransportOwnership } from '../core/transport-constants.js'
/** Classify native adapter I/O failures without duplicating Core's semantic error policy. */
export { identifyRpcBoundaryFailure } from '../core/errors.js'
/** Listener lifecycle and failure primitives shared by platform adapters. */
export {
  collectListenerCleanupFailures,
  collectListenerFailure,
  createListenerFailure,
  createListenerFailureState,
  drainListenerFailures,
  drainTerminalListenerFailures,
  observeListener,
  registerListeners,
  releaseListenerRegistration,
  reportListenerFailure
} from '../core/internal/listener-safety.js'
/** Shared listener fan-out primitive for adapter subscriptions. */
export { createMessageListenerHub } from '../core/internal/message-listener-hub.js'
/** Safe access and diagnostics for hostile platform event objects. */
export { safeRead, safeString } from '../core/internal/safe-value.js'
export * from '../core/transport-constants.js'
/** Genuine object channels mint their own agreement; callers cannot inject private trust writers. */
export { holdAdapterObjectChannel } from '../runtime-adapter/object/connection.js'
export { materializeAdapterJson } from '../runtime-adapter/object/pipeline.js'
export type { IRuntimeObjectIO, IRuntimeObjectChannel } from '../runtime-adapter/object/types.js'
/** Native authors capture cold binding recipes; this grants no channel or private proof identity. */
export { createAdapterDeployment } from '../runtime-adapter/deployment.js'
export type {
  IAdapterDeployment,
  IAdapterDeploymentContext,
  IAdapterDeploymentEndpointPreparation,
  IAdapterDeploymentListener,
  IAdapterDeploymentRecipe,
  IAdapterManagedDeployment
} from '../runtime-adapter/deployment.js'

/** JSON-RPC adapters reuse these pure admissions and canonical error/diagnostic owners. */
export {
  prepareJsonRpcOffer,
  readJsonRpcReply,
  assertJsonRpcExtensions,
  validateJsonRpcDescription
} from '../runtime-adapter/jsonrpc/handshake.js'
export { serializeRpcError, deserializeRpcError } from '../core/internal/error-wire-metadata.js'
export { RpcCarrierDetailKey } from '../core/adapters/probe-detail.js'
export { RpcAdapterErrorText } from '../core/adapters/error-text.js'
export { createRpcTransportError } from '../core/errors.js'

/** Process feature wrappers configure these existing per-connection gate/log contracts. */
export { IpcSendClass, IpcLogEventName } from '../core/plugins/flow-control.js'
export type {
  IIpcLogInstallation,
  IIpcSendGate,
  IIpcLogRecord,
  IIpcSendQueueOptions
} from '../core/plugins/flow-control.js'

/** Adapter authors reuse the original gate/log installations without wrapping physical send twice. */
export { createIpcSendQueueFeature } from '../core/plugins/send-queue.js'
export { createIpcLogFeature } from '../core/plugins/log.js'

/** Only actual private bootstrap snapshots can mint a pre-endpoint byte source identity. */
export { holdAdapterByteBootstrapSource } from '../runtime-adapter/byte/bootstrap-source.js'
export type { IAdapterByteBootstrapSource } from '../runtime-adapter/byte/bootstrap-source.js'
export type { IAdapterBytePeerOptions } from '../runtime-adapter/byte/peer.js'
export type {
  IAdapterDeploymentAccept,
  IAdapterDeploymentAcceptedSession
} from '../runtime-adapter/deployment.js'

/** Capture native thread first-frame identity before the host constructs its single endpoint. */
export { holdAdapterMessageBootstrapSource } from '../runtime-adapter/message/bootstrap-source.js'
export type { IAdapterMessageBootstrapSource } from '../runtime-adapter/message/bootstrap-source.js'

/** Shared native message preparation lends its original finite deadline to carrier listeners. */
export { createAdapterMessageHandshakeBudget } from '../runtime-adapter/message/resource.js'
export type { IAdapterMessageHandshakeBudget } from '../runtime-adapter/message/types.js'
/** Native task ports preserve the existing attach-before-start event contract and diagnostics. */
export { MessageResourceEvent } from '../runtime-adapter/message/constants.js'
export { RuntimeApiErrorText } from '../remote/runtime-api/constants.js'
/** Browser public carrier shells reuse these exact native subscription and qualification owners. */
export { createBrowserMessagePortTransport } from '../core/adapters/message-port.js'
export type {
  IBrowserMessagePortLike,
  IBrowserMessagePortTransportOptions
} from '../core/adapters/message-port.js'
export { createWebWorkerTransport } from '../core/adapters/web-worker.js'
export type {
  IWebWorkerLikePort,
  IWebWorkerPortEvent,
  IWebWorkerTransportOptions
} from '../core/adapters/web-worker.js'

/** Reliable Web transports and Process share one native reader/writer lifetime. */
export { createRuntimeWebByteStream } from '../runtime-adapter/byte/web-byte-stream.js'
export type {
  IRuntimeWebByteStreamOptions,
  IRuntimeByteStreamReader,
  IRuntimeByteStreamWriter,
  IRuntimeReadableByteStream,
  IRuntimeWritableByteStream
} from '../runtime-adapter/byte/web-byte-stream.js'
