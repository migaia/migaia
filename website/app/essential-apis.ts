/**
 * Curated entry points each library's sidebar lists first, before its complete API inventory.
 *
 * Every library exports helpers that most applications never call (error constructors, policy
 * readers, low-level codecs). Listing them beside the factory a reader actually starts from hides
 * that factory, so this file names the few APIs that carry the library's main use cases. The full
 * inventory stays one disclosure away; nothing is removed from navigation.
 *
 * Entries are `module:name` (or bare `name` for the root module) in reading order. Libraries with
 * only a handful of public entries need no entry here. `rpc-core`, `rpc-process` and `rpc-threads`
 * keep their dedicated "Primary endpoints" group in the docs route instead.
 */
export const essentialApis: Readonly<Record<string, readonly string[]>> = {
  capability: [
    'createCapabilityHost',
    'graph:createCapabilityGraph',
    'graph/dynamic:createDynamicCapabilityGraph'
  ],
  'event-subscriber': [
    'createEventChannel',
    'createEventHub',
    'subscriber:subscribeOnce',
    'subscriber:subscribeUntil'
  ],
  lifecycle: [
    'scope:createLifecycleScope',
    'generation:createGenerationController',
    'quiescence:createPendingTracker',
    'boundedWait',
    'createProvisionalScope',
    'disposal:createDisposeTransaction'
  ],
  logger: ['Logger', 'plugins:level', 'plugins:batch', 'plugins:http', 'plugins/file:file'],
  'plugin-host': ['PluginHost', 'definePlugin', 'defineFeature', 'defineHost'],
  reactive: [
    'createRuntime',
    'extension:getDefaultRuntime',
    'extension:createObserverBinding',
    'extension:createFieldSource'
  ],
  'rpc-browser': [
    'createBrowserPeer',
    'adapters/window:createWindowMessageTransport',
    'adapters/broadcast-channel:createBroadcastChannelTransport',
    'adapters/service-worker:createServiceWorkerTransport'
  ],
  'rpc-contract': [
    'createDescriptor',
    'errors:serializeRpcError',
    'errors:deserializeRpcError',
    'errors:toJsonRpcError',
    'framing/jsonrpc:encodeJsonRpcFrame',
    'framing/jsonrpc:createJsonRpcFrameDecoder',
    'handshake:createRpcHello',
    'handshake:acceptRpcHandshake',
    'handshake:completeRpcHandshake'
  ],
  'rpc-devtools': ['createRpcDevtools', 'hub:createRpcDevtoolsHub', 'log:createRpcLogProbe'],
  serialize: [
    'registry:createSerializeRegistry',
    'plugins:jsonPlugin',
    'core:encodeStream',
    'core:decodeStream'
  ],
  'storage-web': [
    'host:createStorageHost',
    'entity:defineEntity',
    'indexed-db:indexedDbHost',
    'local-storage:localStorageHost',
    'memory:memoryStorageHost'
  ],
  'store-devtools': ['createStoreDevTools', 'getDependencyTree', 'getObserverTree'],
  'store-indexed': [
    'ObservableObject',
    'ObservableArray',
    'ObservableMap',
    'ObservableSet',
    'observableObject',
    'observableArray'
  ],
  'store-keyed': [
    'atom/store:createAtomStore',
    'atom/definition:atomDef',
    'atom/definition:derivedDef',
    'familyDef',
    'splitDef',
    'focusDef',
    'selectDef'
  ],
  'store-light': [
    'createStore',
    'createAsyncStore',
    'createStoreResource',
    'createStoreResourceScope',
    'raw'
  ],
  'store-middleware': [
    'bindStoreMiddleware',
    'createStoreMiddlewareHost',
    'createMutationPolicy',
    'loggerMiddleware',
    'createReduxDevToolsAdapter'
  ],
  'store-persist': [
    'light:persist',
    'keyed:persistKeyed',
    'indexed:persistCollection',
    'persistUnit'
  ],
  'store-react': [
    'StoreProvider',
    'useStore',
    'useTracked',
    'useAtomValue',
    'useSetAtom',
    'useAtom',
    'useResourceValue',
    'createStoreRegistry'
  ],
  'store-ssr': [
    'createSSRRequestScope',
    'createSSRStateScript',
    'readSSRStateFromDocument',
    'serializeSSRState'
  ],
  'store-wasm': ['ensureWasm', 'number', 'string', 'boolean', 'array', 'record'],
  'store-worker': [
    'WorkerAdapter',
    'createWorkerHandler',
    'workerComputed',
    'serialize:createSerializeWorkerHandler'
  ],
  supervision: [
    'createUnitBudget',
    'coroutine:createCoroutineSupervisor',
    'process:createProcessSupervisor',
    'threads:createThreadSupervisor',
    'createSupervisor'
  ],
  tray: ['createTray', 'defineTrayHost', 'createTrayGraph', 'defineRoutingPolicy', 'serveTrayHost'],
  utils: [
    'promise:retry',
    'promise:withTimeout',
    'promise:deferred',
    'promise:sleep',
    'promise:createConcurrencyLimiter',
    'function:once',
    'object-path:get',
    'object-path:set',
    'config:ownConfig',
    'config:patchConfig'
  ]
}

/** Splits one curated entry into its owning module and symbol name. */
export function essentialApiParts(entry: string): {
  readonly module: string
  readonly name: string
} {
  /** The last colon separates the module path from the symbol name. */
  const separator = entry.lastIndexOf(':')
  return separator < 0
    ? { module: 'index', name: entry }
    : { module: entry.slice(0, separator), name: entry.slice(separator + 1) }
}
