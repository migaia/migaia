import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyExports from '../fixtures/legacy-exports.json'
import errorFormatDelta from '../fixtures/error-format-export-delta.json'
import controlSemanticsDelta from '../fixtures/control-semantics-export-delta.json'
import streamingDelta from '../fixtures/streaming-export-delta.json'
import coreRefactorDelta from '../fixtures/core-refactor-export-delta.json'

/** Package root whose manifest and built files define the new public surface. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
/** Physical runtime owner namespace migration; canonical semantic source directories remain intact. */
function splitEntry(name: string) {
  const current = (coreRefactorDelta.relocations as Record<string, string>)[name] ?? name
  const suffix = current.slice('@migaia/rpc/'.length)
  const [domain, ...rest] = suffix.split('/')
  const owner =
    domain === 'contract'
      ? 'rpc-contract'
      : domain === 'core' || domain === 'remote' || domain === 'testing'
        ? 'rpc-core'
        : domain === 'process'
          ? 'rpc-process'
          : domain === 'threads'
            ? 'rpc-threads'
            : 'rpc-browser'
  const tail = rest.join('/')
  const key = domain === 'remote' || domain === 'testing' ? `./${domain}` : tail ? `./${tail}` : '.'
  return { current, owner, root: join(packageRoot, owner), key }
}
/**
 * Explicit C3 ordinary toolkit and held-resource entries replace the three retired helper
 * namespaces.
 */
const ordinaryEntries: Record<string, Record<string, string[]>> = {
  'rpc-contract': {
    './wire': [
      'RpcBatchPhysical',
      'RpcBinaryField',
      'RpcBinaryProfile',
      'RpcBinaryStorage',
      'RpcBinaryTag',
      'RpcBinaryViolation',
      'RpcCapability',
      'RpcCodecId',
      'RpcControl',
      'RpcEnvelopeKind',
      'RpcEnvelopeViolation',
      'RpcErrorReachLimit',
      'RpcHandshakeReason',
      'RpcHandshakeStep',
      'RpcHandshakeViolation',
      'RpcJsonRpcWireError',
      'RpcNativeBinaryKind',
      'RpcPeerRuntime',
      'RpcProtocol',
      'RpcReservedKind',
      'RpcRouteField',
      'RpcRouteKey',
      'RpcRouteProfile',
      'RpcRouteType',
      'RpcRuntimeCancel',
      'RpcRuntimeCarrier',
      'RpcRuntimeField',
      'RpcRuntimeFinish',
      'RpcRuntimeGenerationKind',
      'RpcRuntimeKind',
      'RpcRuntimeMode',
      'RpcRuntimeOperation',
      'RpcRuntimeOutcomeState',
      'RpcRuntimeProfile',
      'RpcRuntimeStepState',
      'RpcRuntimeStoreContinuity',
      'RpcRuntimeStoreKind',
      'RpcRuntimeStreamPrefix',
      'RpcStreamEvent',
      'RpcStreamLimit',
      'RpcStreamViolation',
      'RpcWireErrorFallback',
      'RpcWireErrorField',
      'RpcWireErrorLimit',
      'RpcWireErrorUnknownFieldMode',
      'RpcWireErrorViolation',
      'RpcWireLimit',
      'measurePortableStreamValue'
    ],
    './portable': ['RPC_PORTABLE_MAX_DEPTH', 'normalizePortable'],
    './errors': [
      'RPC_CONTRACT_SOURCE',
      'RpcContractErrorCode',
      'RpcErrorReachLimit',
      'RpcJsonRpcWireError',
      'RpcWireErrorFallback',
      'RpcWireErrorField',
      'RpcWireErrorLimit',
      'RpcWireErrorUnknownFieldMode',
      'RpcWireErrorViolation',
      'classifyRpcContractError',
      'deserializeRpcError',
      'fromJsonRpcError',
      'normalizeRpcSerializedError',
      'reachRpcError',
      'serializeRpcError',
      'toJsonRpcError'
    ],
    './handshake': [
      'RpcCapability',
      'RpcHandshakeReason',
      'RpcHandshakeStep',
      'RpcHandshakeViolation',
      'RpcProtocol',
      'acceptRpcHandshake',
      'completeRpcHandshake',
      'createRpcHello',
      'normalizeRpcHandshake'
    ],
    './runtime': [
      'RpcRuntimeCancel',
      'RpcRuntimeCarrier',
      'RpcRuntimeField',
      'RpcRuntimeFinish',
      'RpcRuntimeGenerationKind',
      'RpcRuntimeKind',
      'RpcRuntimeMode',
      'RpcRuntimeOperation',
      'RpcRuntimeOutcomeState',
      'RpcRuntimeProfile',
      'RpcRuntimeStepState',
      'RpcRuntimeStoreContinuity',
      'RpcRuntimeStoreKind',
      'RpcRuntimeStreamPrefix',
      'normalizeRuntimeEnvelope',
      'normalizeRuntimeEnvelopeDecoded',
      'normalizeRuntimeGeneration',
      'normalizeRuntimeSteps',
      'readRuntimeCarrier',
      'runtimeOperationCapabilities',
      'rpcByteRuntimeBootstrap',
      'rpcMessageCapabilityControl',
      'wrapRuntimeCarrier'
    ],
    './runtime/metadata': [
      'createRuntimeCallEnvelope',
      'normalizeRuntimeGeneration',
      'normalizeRuntimeSteps'
    ],
    './runtime/lazy': [
      'normalizeRuntimeEnvelope',
      'normalizeRuntimeEnvelopeDecoded',
      'normalizeStreamPayload'
    ],
    './binary/inspect': [
      'RpcBinaryProfile',
      'RpcBinaryStorage',
      'RpcNativeBinaryKind',
      'assertRpcNativeBinaryFrameSize',
      'hasRpcBinaryEnvelope',
      'isRpcBinaryIntegrityFailure',
      'measureRpcNativeBinaryFrame',
      'readRpcNativeBinary',
      'rpcBinaryBackingLength',
      'rpcBinaryView'
    ],
    './framing/jsonrpc': [
      'JSONRPC_BRIDGE_ERROR_SOURCE',
      'JsonRpcBridgeErrorCode',
      'JsonRpcLimit',
      'createJsonRpcFrameDecoder',
      'encodeJsonRpcFrame'
    ],
    './binary': [
      'RpcBinaryProfile',
      'RpcBinaryStorage',
      'RpcNativeBinaryKind',
      'captureRpcBinaryData',
      'prepareRpcBinary',
      'restoreRpcBinary',
      'restoreRpcBinaryDecoded'
    ],
    './binary/lazy': [
      'RpcBinaryProfile',
      'RpcBinaryStorage',
      'RpcNativeBinaryKind',
      'prepareRpcBinary',
      'restoreRpcBinary',
      'restoreRpcBinaryDecoded'
    ],
    './binary/capture': ['RpcBinaryStorage', 'captureRpcBinaryData'],
    './stream': [
      'RpcStreamEvent',
      'RpcStreamLimit',
      'RpcStreamPointer',
      'RpcStreamViolation',
      'checkRpcRuntimeStreamFinish',
      'checkRpcRuntimeStreamIntent',
      'checkRpcRuntimeStreamTransition',
      'checkRpcStreamConsumerCredit',
      'checkRpcStreamInitialSequence',
      'checkRpcStreamProducerCredit',
      'checkRpcStreamProgress',
      'checkRpcStreamSequence',
      'measurePortableStreamValue',
      'normalizeStreamPayload'
    ]
  },
  'rpc-core': {
    /** Revision 3 adds current-stage control and canonical reporter exports to the Probe entry. */
    './probe': [
      'RpcProbeStage',
      'RpcProbeStageName',
      'RpcProbeDirection',
      'RpcProbeDirectionName',
      'RpcProbeKind',
      'RpcProbeKindName',
      'RpcProbeOutcome',
      'RpcProbeOutcomeName',
      'defineProbe',
      'snapshotProbeEvent',
      'rpcProbeSampleKey',
      'probePlugin',
      'readProbeStages',
      'subscribeProbeStages',
      'hostRethrowReporter',
      'IpcReporterContext'
    ],
    /** P5 SDK exposes only the two task-level factories to ordinary adapter authors. */
    './adapter': ['defineByteAdapter', 'defineMessageAdapter'],
    /** Only real native owners retain the moved low-level runtime operations. */
    './adapter/internal-advanced': [
      'JSONRPC_ALLOWED_CAPABILITIES',
      'JSONRPC_REQUIRED_CAPABILITIES',
      'JSONRPC_REQUIRED_METHODS',
      'IpcReporterContext',
      'JsonRpcErrorNumber',
      'JsonRpcProfile',
      'assembleAdapterPlugin',
      'captureAdapterTask',
      'carrierSizeBytes',
      'createAdapterBindingDrain',
      'createAdapterConfigurationError',
      'createAdapterConfigurationTypeError',
      'createAdapterId',
      'createAdapterJsonRpcChannel',
      'createAdapterPlugin',
      'createAdapterSourceConfigurationError',
      'createAdapterTransportError',
      'createEventEmitterMessageResource',
      'createEventTargetMessageResource',
      'createJsonRpcBridgeError',
      'createRuntimeByteConnection',
      'createRuntimeEventByteIO',
      'createRuntimeMessageConnection',
      'createRuntimeProviderGovernor',
      'createRuntimeProviderScope',
      'holdAdapterLaunch',
      'holdAdapterRegistration',
      'readAdapterAbortReason',
      'readRuntimeByteBootstrap',
      'resolveAdapterEntry',
      'retainAdapterRuntimeFlags',
      'validateAdapterPeerMethods',
      'validateAdapterPeerTimeout'
    ]
  },
  'rpc-browser': {
    /** Browser's root Peer joins the same ordinary API inventory as the other carrier owners. */
    '.': ['createBrowserPeer', 'RpcBrowserErrorCode', 'RPC_BROWSER_ERROR_SOURCE']
  }
}
/** C3 retires factories/claim-oriented helpers; ordinary operations now own each violation or state. */
const retiredSymbols: Record<string, readonly string[]> = {
  '@migaia/rpc/contract': ['invalidRpcStream'],
  '@migaia/rpc/contract/v1': ['invalidRpcStream'],
  '@migaia/rpc/contract/framing': ['rejectRpcPhysicalFrameSize'],
  /** Core constructors are internal except the real caller-owned lifecycle error use. */
  '@migaia/rpc/core': [
    'RpcError',
    'RpcSchemaValidationError',
    'RpcConfigurationError',
    'RpcConstructionError',
    'RpcSerializationError',
    'RpcProtocolError',
    'RpcContractError',
    'RpcTransportError',
    'RpcAuthenticationError',
    'RpcChunkError',
    'RpcRemoteError',
    'RpcAbortError',
    'RpcTimeoutError',
    'tagRpcError'
  ]
}
/**
 * Explicit former helper symbol routing retains protocol users without re-creating helper
 * namespaces.
 */
const formerProtocolOperations: Record<string, string> = {
  createRpcStreamFrameDecoderWithLimit: '@migaia/rpc-contract/framing/stream',
  isRpcBinaryIntegrityFailure: '@migaia/rpc-contract/binary/inspect',
  measureRpcNativeBinaryFrame: '@migaia/rpc-contract/binary/inspect',
  normalizeRuntimeEnvelope: '@migaia/rpc-contract/runtime',
  normalizeRuntimeGeneration: '@migaia/rpc-contract/runtime/metadata',
  normalizeRuntimeSteps: '@migaia/rpc-contract/runtime/metadata',
  prepareRpcBinary: '@migaia/rpc-contract/binary',
  readRpcNativeBinary: '@migaia/rpc-contract/binary/inspect',
  readRuntimeCarrier: '@migaia/rpc-contract/runtime',
  restoreRpcBinary: '@migaia/rpc-contract/binary',
  rpcBinaryBackingLength: '@migaia/rpc-contract/binary/inspect',
  rpcBinaryView: '@migaia/rpc-contract/binary/inspect',
  runtimeOperationCapabilities: '@migaia/rpc-contract/runtime',
  wrapRuntimeCarrier: '@migaia/rpc-contract/runtime'
}

/** Applies the layered core naming decision to the frozen merge export snapshot. */
function layeredName(name: string): string {
  if (name === 'WEBRPC_SOURCE') return 'RPC_CORE_ERROR_SOURCE'
  if (name === 'WebRpcErrorCode') return 'RpcCoreErrorCode'
  if (name.startsWith('WebRpc')) return `Rpc${name.slice('WebRpc'.length)}`
  if (name.startsWith('isWebRpc')) return `isRpc${name.slice('isWebRpc'.length)}`
  if (name.startsWith('tagWebRpc')) return `tagRpc${name.slice('tagWebRpc'.length)}`
  return name
}

/** Walk compiled core files to reject a second copy of the contract implementation. */
function compiledCoreFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? compiledCoreFiles(path) : entry.name.endsWith('.js') ? [path] : []
  })
}

describe('A1 merged public exports', () => {
  it('preserves the merged runtime export sets and the layered transport kit', async () => {
    const manifests = Object.fromEntries(
      ['rpc-contract', 'rpc-core', 'rpc-process', 'rpc-threads', 'rpc-browser'].map((owner) => [
        owner,
        JSON.parse(readFileSync(join(packageRoot, owner, 'package.json'), 'utf8')) as {
          exports: Record<string, { default: string; types: string }>
        }
      ])
    )
    const manifest = manifests['rpc-core']!
    const expected = [
      ...Object.keys(legacyExports),
      '@migaia/rpc/core/transport-kit',
      '@migaia/rpc/core/stream',
      '@migaia/rpc/core/plugins/flow-control',
      '@migaia/rpc/core/plugins/send-queue',
      '@migaia/rpc/core/plugins/log',
      '@migaia/rpc/remote',
      '@migaia/rpc/testing',
      '@migaia/rpc/process',
      '@migaia/rpc/process/adapters/node-child-process',
      '@migaia/rpc/process/adapters/node-socket',
      '@migaia/rpc/process/adapters/bun-spawn',
      '@migaia/rpc/process/adapters/bun-socket',
      '@migaia/rpc/process/adapters/deno-command',
      '@migaia/rpc/process/adapters/deno-socket',
      '@migaia/rpc/process/adapters/electron-utility-process',
      '@migaia/rpc/process/adapters/windows-job',
      '@migaia/rpc/contract/framing/stream',
      '@migaia/rpc/threads',
      ...['node', 'deno', 'bun', 'electron-main', 'electron-renderer', 'browser'].map(
        (name) => `@migaia/rpc/threads/adapters/${name}`
      )
    ]
      .map((name) => (coreRefactorDelta.relocations as Record<string, string>)[name] ?? name)
      .sort()
    expect(expected).toHaveLength(48)
    const currentEntries = expected.map((name) => {
      const entry = splitEntry(name)
      return `${entry.owner}:${entry.key}`
    })
    for (const [owner, entries] of Object.entries(ordinaryEntries))
      currentEntries.push(...Object.keys(entries).map((key) => `${owner}:${key}`))
    currentEntries.push('rpc-contract:./schema/wire-error')
    expect(currentEntries).toHaveLength(66)
    expect(
      Object.entries(manifests)
        .flatMap(([owner, entry]) => Object.keys(entry.exports).map((key) => `${owner}:${key}`))
        .sort()
    ).toEqual(currentEntries.sort())
    for (const [name, baseline] of Object.entries(legacyExports)) {
      const { current: currentName, root: ownerRoot, key, owner } = splitEntry(name)
      const entry = manifests[owner]!.exports[key]
      expect(entry, name).toBeDefined()
      const relative = entry.default.replace(/^\.\//, '')
      const suffix = currentName.slice('@migaia/rpc/'.length)
      const indexed = new Set(['contract', 'contract/v1', 'contract/framing', 'core'])
      const expectedRelative = `dist/${suffix}${indexed.has(suffix) ? '/index' : ''}.js`
      expect(relative.startsWith('dist/'), name).toBe(true)
      expect(relative.endsWith('.js'), name).toBe(true)
      expect(entry.types, name).toBe(entry.default.replace(/\.js$/, '.d.ts'))
      expect(existsSync(join(ownerRoot, relative)), name).toBe(true)
      expect(existsSync(join(ownerRoot, entry.types)), name).toBe(true)
      expect(
        Object.keys(await import(pathToFileURL(join(ownerRoot, relative)).href)).sort(),
        name
      ).toEqual(
        [
          ...new Set([
            ...(name.startsWith('@migaia/rpc/core')
              ? baseline.names.map(layeredName)
              : baseline.names
            ).filter(
              (item) =>
                !(retiredSymbols[name] ?? []).includes(item) &&
                !((errorFormatDelta.removed as Record<string, string[]>)[name] ?? []).includes(
                  item
                ) &&
                !((controlSemanticsDelta.removed as Record<string, string[]>)[name] ?? []).includes(
                  item
                )
            ),
            ...((errorFormatDelta.added as Record<string, string[]>)[name] ?? []),
            ...((controlSemanticsDelta.added as Record<string, string[]>)[name] ?? []),
            ...((streamingDelta.added as Record<string, string[]>)[name] ?? []),
            // Cross-package runtime adapters consume the same canonical fallback reporter.
            ...(name === '@migaia/rpc/core'
              ? ['RpcProviderRejectionReason', 'defaultRpcReporter']
              : []),
            ...(name === '@migaia/rpc/contract'
              ? ['RPC_CONTRACT_SOURCE', 'RpcBatchPhysical', 'classifyRpcContractError']
              : []),
            ...(name === '@migaia/rpc/core'
              ? [
                  'serializeRpcError',
                  'deserializeRpcError',
                  'isRpcErrorInstance',
                  'isRpcRemoteError',
                  'isRpcTimeoutError'
                ]
              : []),
            ...(name === '@migaia/rpc/contract/framing'
              ? ['processStringFramer', 'remoteProcessStringFramer', 'inspectRpcPhysicalFrame']
              : []),
            ...((coreRefactorDelta.added as Record<string, string[]>)[name] ?? [])
          ])
        ]
          .filter((item) => !(retiredSymbols[name] ?? []).includes(item))
          .sort()
      )
      // A leaf export maps to its own source path; index entries map to directory roots.
      expect(relative, name).toBe(expectedRelative)
    }
    const coreRoot = join(packageRoot, 'rpc-core')
    const stream = manifest.exports['./stream']
    expect(stream).toEqual({
      types: './dist/core/stream/index.d.ts',
      default: './dist/core/stream/index.js'
    })
    expect(
      Object.keys(await import(pathToFileURL(join(coreRoot, stream.default)).href)).sort()
    ).toEqual(['createCanonicalChunkFeature', 'createStreamFeature'])
    const remote = manifest.exports['./remote']
    expect(remote).toEqual({
      types: './dist/remote/index.d.ts',
      default: './dist/remote/index.js'
    })
    expect(
      Object.keys(await import(pathToFileURL(join(coreRoot, remote.default)).href)).sort()
    ).toEqual(
      [
        ...new Set([
          'RemoteMethodMode',
          'REMOTE_NAME_PATTERN',
          'REMOTE_METHOD_MAX_LENGTH',
          'REMOTE_SCHEMA_VERSION',
          'REMOTE_METHOD_MODES',
          'RemoteMethodName',
          'RuntimePluginKey',
          'RpcRemoteLayerErrorCode',
          'RPC_REMOTE_ERROR_SOURCE',
          'normalizeRemoteContract',
          'normalizeRemoteHostCatalog',
          'normalizeRemoteControlShape',
          'sameRemoteContract',
          'createRemotePlugin',
          'createRemoteRetryPort',
          'serveRemotePlugin',
          'createRemoteHost',
          'serveRemoteHost',
          'createCoroutinePlugin',
          ...coreRefactorDelta.added['@migaia/rpc/remote']
        ])
      ].sort()
    )
    /** Every C3 ordinary entry retains an exact namespace, with no claimed preparation exports. */
    for (const [owner, entries] of Object.entries(ordinaryEntries)) {
      for (const [key, names] of Object.entries(entries)) {
        const entry = manifests[owner]!.exports[key]!
        const ownerRoot = join(packageRoot, owner)
        expect(existsSync(join(ownerRoot, entry.types)), `${owner}:${key}`).toBe(true)
        expect(
          Object.keys(await import(pathToFileURL(join(ownerRoot, entry.default)).href)).sort(),
          `${owner}:${key}`
        ).toEqual([...names].sort())
      }
    }
    for (const [symbol, module] of Object.entries(formerProtocolOperations))
      expect(await import(module), symbol).toHaveProperty(symbol)
    /** C3 exposes only scalar metadata from the existing owner, without its family tokens. */
    const remoteNamespace = await import(pathToFileURL(join(coreRoot, remote.default)).href)
    /** Canonical identity prevents a copied table or wrapper from becoming another vocabulary owner. */
    const runtimeConstants = await import(
      pathToFileURL(join(coreRoot, './dist/remote/runtime-api/constants.js')).href
    )
    expect(remoteNamespace.RuntimePluginKey).toBe(runtimeConstants.RuntimePluginKey)
    expect(remoteNamespace.RuntimePluginKey).toEqual({
      process: 'process',
      thread: 'thread',
      coroutine: 'coroutine'
    })
    expect(remoteNamespace).not.toHaveProperty('RuntimePluginFamily')
    /** The retired package contributes no current entry; Contract retains the original codes. */
    expect(existsSync(join(packageRoot, 'rpc-bridge-jsonrpc/package.json'))).toBe(false)
    const framing = await import('@migaia/rpc-contract/framing/jsonrpc')
    expect(framing.JSONRPC_BRIDGE_ERROR_SOURCE).toBe('@migaia/rpc/bridge/jsonrpc')
    expect(Object.keys(framing.JsonRpcBridgeErrorCode)).toHaveLength(5)
    /** Former Core Process operations retain one exact namespace at their owning package root. */
    const processEntry = manifests['rpc-process']!.exports['.']!
    expect(
      Object.keys(
        await import(pathToFileURL(join(packageRoot, 'rpc-process', processEntry.default)).href)
      ).sort()
    ).toEqual(
      [
        'PROCESS_HANDSHAKE_MAX_FRAME_BYTES',
        'PROCESS_RUNTIME_API_BOOTSTRAP_KIND',
        'PROCESS_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS',
        'PROCESS_RUNTIME_API_BOOTSTRAP_VERSION',
        'PROCESS_RUNTIME_API_ENV',
        'PROCESS_RUNTIME_API_ENV_VERSION',
        'PROCESS_RUNTIME_API_FINGERPRINT_PREFIX',
        'ProcessPluginWire',
        'RPC_PROCESS_ERROR_SOURCE',
        'RpcProcessErrorCode',
        'createAdapterProcessLaunch',
        'createAdapterProcessPeer',
        'createAdapterProcessPlugin',
        'createAdapterWebByteIO',
        'createNativeProcessOffer',
        'createProcessChannelClosedError',
        'createProcessPeer',
        'createProcessJsonRpcChannel',
        'createProcessPlugin',
        'createProcessResilience',
        'createProcessTransport',
        'openProcessObjectChannel',
        'isProcessChild',
        'parseProcessPluginDescriptor',
        'receiveAdapterBootstrap'
      ].sort()
    )
    /** Both redundant factory names were removed instead of retained as aliases. */
    const processNamespace = await import('@migaia/rpc-process')
    expect(processNamespace).not.toHaveProperty('createJsonRpcAdapterChannel')
    expect(processNamespace).not.toHaveProperty('createJsonRpcRemoteChannel')
    /** Moved raw native operations belong to the already-public native adapter entries. */
    const nodeProcesses = await import('@migaia/rpc-process/adapters/node-child-process')
    expect(Object.keys(nodeProcesses).sort()).toEqual(
      [
        'createAdapterChildStdio',
        'createAdapterNodeProcessLaunch',
        'createAdapterProcessStdio',
        'createNodeProcessLauncher',
        'openProcessStdioChannel'
      ].sort()
    )
    /** The socket adapter owns its actual held native stream constructor. */
    const nodeSockets = await import('@migaia/rpc-process/adapters/node-socket')
    expect(Object.keys(nodeSockets).sort()).toEqual(
      ['createAdapterSocketByteIO', 'dialProcessByteChannel', 'listenProcessByteChannel'].sort()
    )
    /** C5 removes text/constructor/lazy aliases without weakening the exact ordinary namespaces. */
    for (const [owner, entries] of Object.entries(manifests)) {
      for (const [key, entry] of Object.entries(entries.exports)) {
        if (owner === 'rpc-contract' && key === './schema/wire-error') continue
        const namespace = await import(pathToFileURL(join(packageRoot, owner, entry.default)).href)
        expect(
          Object.keys(namespace).filter((name) => /(?:ErrorText|Diagnostic|Lazy)$/.test(name))
        ).toEqual([])
      }
    }
    /** Protocol implementations consume the unchanged closed JSON schema through its public path. */
    const schemaEntry = manifests['rpc-contract']!.exports['./schema/wire-error']!
    expect(schemaEntry).toEqual({ default: './schema/wire-error.schema.json' })
    const wireSchema = await import('@migaia/rpc-contract/schema/wire-error', {
      with: { type: 'json' }
    })
    // Vitest's JSON transform adds named keys; the native namespace is checked by packed smoke.
    expect(wireSchema.default).toEqual(
      JSON.parse(readFileSync(join(packageRoot, 'rpc-contract', schemaEntry.default), 'utf8'))
    )
    /** Native adapters expose diagnostics at their user-facing package root. */
    const threads = await import('@migaia/rpc-threads')
    /** Former Core Thread operations now retain one exact owning package namespace. */
    expect(Object.keys(threads).sort()).toEqual(
      [
        'AdapterNodeThreadParentChannel',
        'RPC_THREAD_ERROR_SOURCE',
        'RpcThreadErrorCode',
        'createAdapterNodeThreadLauncher',
        'createAdapterNodeThreadPeer',
        'createNodeThreadChannel',
        'createThreadPeer',
        'createThreadPlugin',
        'isThreadChild',
        'createWebThreadChannel',
        'createWebThreadChannelFactory',
        'createWebThreadLauncher',
        'readThreadBootstrap',
        'receiveThreadData'
      ].sort()
    )
    /** The moved Node channel factory uses its already-public native-owner entry. */
    const nodeThreads = await import('@migaia/rpc-threads/adapters/node')
    expect(Object.keys(nodeThreads).sort()).toEqual(
      ['createNodeThreadChannelFactory', 'createNodeThreadLauncher'].sort()
    )
    expect(threads.RPC_THREAD_ERROR_SOURCE).toBe('@migaia/rpc/threads')
    expect(threads.RpcThreadErrorCode.usageSampleFailed).toBe('THREAD_USAGE_SAMPLE_FAILED')
  })

  it('A5 BC1 exports the runtime coroutine plugin and removes the legacy host', async () => {
    /** BC1 keeps the public factory name while moving its owner to the runtime family. */
    const coreRoot = join(packageRoot, 'rpc-core')
    /** The built public entry is the surface consumed by applications and website manifests. */
    const remoteNamespace = await import(pathToFileURL(join(coreRoot, 'dist/remote/index.js')).href)
    expect(remoteNamespace.createCoroutinePlugin).toEqual(expect.any(Function))
    expect.soft(remoteNamespace).not.toHaveProperty('createCoroutineHost')
    expect.soft(remoteNamespace.RuntimePluginKey).toEqual({
      process: 'process',
      thread: 'thread',
      coroutine: 'coroutine'
    })
    /** A same-named legacy factory cannot satisfy the new runtime family's ownership contract. */
    const familyModule = join(coreRoot, 'dist/remote/runtime-api/coroutine-plugin.js')
    expect(existsSync(familyModule)).toBe(true)
    /** The public entry re-exports the canonical runtime factory without another wrapper. */
    const coroutineFamily = await import(pathToFileURL(familyModule).href)
    expect(remoteNamespace.createCoroutinePlugin).toBe(coroutineFamily.createCoroutinePlugin)
  })

  it('keeps contract protocol and normalizer implementations outside compiled core', () => {
    expect(existsSync(join(packageRoot, './rpc-core/dist/core'))).toBe(true)
    expect(existsSync(join(packageRoot, './rpc-contract/dist/contract'))).toBe(true)
    const offenders = compiledCoreFiles(join(packageRoot, './rpc-core/dist/core')).filter(
      (path) => {
        const source = readFileSync(path, 'utf8')
        return /(?:function|const|class)\s+(?:rpcProtocolV1|normalizeRpcEnvelope)\b/.test(source)
      }
    )
    expect(offenders).toEqual([])
  })
})
