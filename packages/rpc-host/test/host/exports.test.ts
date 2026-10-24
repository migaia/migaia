import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import * as root from '../../dist/index.js'
import * as sdk from '../../dist/plugin/index.js'
import * as features from '../../dist/features/index.js'

/** The final publication retains the Host, feature factories and explicit authoring tools. */
const expectedEntries = [
  '.',
  './features',
  './features/auth',
  './features/chunk',
  './features/retry',
  './features/timeout',
  './features/typegen',
  './plugin',
  './probe'
]
/** Application exports describe Host behavior and stable failures without lower-level factories. */
const expectedRoot = [
  'RPC_CORE_ERROR_SOURCE',
  'RpcCoreErrorCode',
  'RpcLifecycleError',
  'RpcProviderRejectionReason',
  'createRpcHost',
  'createRpcIdempotencyStore',
  'defaultRpcReporter',
  'isRpcError',
  'isRpcErrorInstance',
  'isRpcRemoteError',
  'isRpcTimeoutError'
]
/** Plugin authors receive the single joined authoring boundary, including canonical object I/O. */
const expectedSdk = [
  'DEFAULT_DRAIN_MS',
  'IpcLogEventName',
  'IpcReporterContext',
  'IpcSendClass',
  'JSONRPC_ALLOWED_CAPABILITIES',
  'JSONRPC_REQUIRED_CAPABILITIES',
  'JSONRPC_REQUIRED_METHODS',
  'JsonRpcErrorNumber',
  'JsonRpcProfile',
  'MessageResourceEvent',
  'REMOTE_METHOD_MAX_LENGTH',
  'REMOTE_METHOD_MODES',
  'REMOTE_NAME_PATTERN',
  'REMOTE_SCHEMA_VERSION',
  'RPC_REMOTE_ERROR_SOURCE',
  'RUNTIME_API_SCHEMA_VERSION',
  'RemoteMethodMode',
  'RemoteMethodName',
  'RpcAdapterErrorText',
  'RpcCandidateStatus',
  'RpcCarrierDetailKey',
  'RpcOperation',
  'RpcPlatform',
  'RpcRemoteLayerErrorCode',
  'RpcTransportEncoding',
  'RpcTransportMode',
  'RpcTransportOwnership',
  'RpcTransportTopology',
  'RuntimeApiErrorText',
  'RuntimeApiMode',
  'RuntimeConnectionDirection',
  'RuntimeEventName',
  'RuntimePluginKey',
  'RuntimeQueryStatus',
  'RuntimeSourceKind',
  'assertJsonRpcExtensions',
  'carrierSizeBytes',
  'collectListenerCleanupFailures',
  'collectListenerFailure',
  'createAdapterBindingDrain',
  'createAdapterConfigurationError',
  'createAdapterConfigurationTypeError',
  'createAdapterDeployment',
  'createAdapterId',
  'createAdapterMessageHandshakeBudget',
  'createAdapterSourceConfigurationError',
  'createAdapterTransportError',
  'createBrowserMessagePortTransport',
  'createEventEmitterMessageResource',
  'createEventTargetMessageResource',
  'createIpcLogFeature',
  'createIpcSendQueueFeature',
  'createJsonRpcBridgeError',
  'createListenerFailure',
  'createListenerFailureState',
  'createMessageListenerHub',
  'createRemoteRetryPort',
  'createRpcTransportError',
  'createRuntimeByteConnection',
  'createRuntimeEventByteIO',
  'createRuntimeMessageConnection',
  'createRuntimeProviderGovernor',
  'createRuntimeProviderScope',
  'createRuntimeWebByteStream',
  'createWebWorkerTransport',
  'defaultRpcReporter',
  'defineByteAdapter',
  'defineFeaturePlugin',
  'defineMessageAdapter',
  'defineTransportPlugin',
  'deserializeRpcError',
  'drainListenerFailures',
  'drainTerminalListenerFailures',
  'holdAdapterByteBootstrapSource',
  'holdAdapterLaunch',
  'holdAdapterMessageBootstrapSource',
  'holdAdapterObjectChannel',
  'identifyRpcBoundaryFailure',
  'materializeAdapterJson',
  'normalizeRemoteContract',
  'normalizeRemoteControlShape',
  'normalizeRemoteHostCatalog',
  'observeListener',
  'prepareJsonRpcOffer',
  'readAdapterAbortReason',
  'readJsonRpcReply',
  'readRuntimeByteBootstrap',
  'registerListeners',
  'releaseListenerRegistration',
  'reportListenerFailure',
  'resolveAdapterEntry',
  'retainAdapterRuntimeFlags',
  'runtimeQuery',
  'safeRead',
  'safeString',
  'sameRemoteContract',
  'serializeRpcError',
  'validateJsonRpcDescription'
]

it('publishes exactly the final Host package entries and runtime symbols', () => {
  /** This is the real package manifest, independent of the generated export registry. */
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(new Set(Object.keys(manifest.exports))).toEqual(new Set(expectedEntries))
  expect(new Set(Object.keys(root))).toEqual(new Set(expectedRoot))
  expect(new Set(Object.keys(sdk))).toEqual(new Set(expectedSdk))
  expect(new Set(Object.keys(features))).toEqual(
    new Set(['authFeature', 'chunkFeature', 'retryFeature', 'timeoutFeature', 'typegenFeature'])
  )
  expect(sdk).not.toHaveProperty('registerJsonObjectPort')
  expect(sdk).not.toHaveProperty('registerBatchAgreement')
  for (const removed of [
    'holdAdapterRegistration',
    'RpcEndpointStatus',
    'validateAdapterPeerMethods',
    'validateAdapterPeerTimeout'
  ])
    expect(sdk).not.toHaveProperty(removed)
})

it('publishes the same feature factory through its named and default entry', async () => {
  for (const name of ['auth', 'chunk', 'retry', 'timeout', 'typegen'] as const) {
    /** A direct module import proves the actual default publication, not an alias table. */
    const entry = await import(`../../dist/features/${name}.js`)
    expect(entry.default).toBe(features[`${name}Feature`])
  }
})
