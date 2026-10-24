import { orderStringKeys } from '@migaia/utils/string'
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
        ? 'rpc-host'
        : domain === 'process'
          ? 'rpc-plugin-process'
          : domain === 'threads'
            ? 'rpc-plugin-thread'
            : 'rpc-plugin-browser'
  const tail = rest.join('/')
  const key = domain === 'remote' || domain === 'testing' ? `./${domain}` : tail ? `./${tail}` : '.'
  return { current, owner, root: join(packageRoot, owner), key }
}
/** Explicit ordinary toolkit and held-resource entries replace the three retired helper namespaces. */
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
    './runtime': [
      'RUNTIME_API_SCHEMA_VERSION',
      'RuntimeApiMode',
      'RuntimeApiModeSource',
      'RuntimeConnectionDirection',
      'RuntimeEventName',
      'RuntimeMetricScope',
      'RuntimeMetricUnit',
      'RuntimeQueryClock',
      'RuntimeQueryReason',
      'RuntimeQueryStatus',
      'RuntimeRecentKind',
      'RuntimeResourceKind',
      'RuntimeSourceKind',
      'checkRuntimeDescription',
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
      'JSONRPC_ALLOWED_CAPABILITIES',
      'JSONRPC_REQUIRED_CAPABILITIES',
      'JSONRPC_REQUIRED_METHODS',
      'JsonRpcErrorNumber',
      'JsonRpcProfile',
      'checkJsonRpcDescription',
      'JSONRPC_BRIDGE_ERROR_SOURCE',
      'JsonRpcBridgeErrorCode',
      'JsonRpcLimit',
      'createJsonRpcFrameDecoder',
      'encodeJsonRpcFrame'
    ],
    './binary/lazy': [
      'RpcBinaryProfile',
      'RpcBinaryStorage',
      'RpcNativeBinaryKind',
      'prepareRpcBinary',
      'restoreRpcBinary',
      'restoreRpcBinaryDecoded'
    ],
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
  'rpc-host': {
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
      'rpcProbeSampleKey',
      'readProbeStages',
      'subscribeProbeStages',
      'hostRethrowReporter',
      'IpcReporterContext'
    ]
  },
  'rpc-plugin-browser': {
    /** Browser users select one cold carrier through the package root. */
    '.': [
      'windowPlugin',
      'dedicatedWorkerPlugin',
      'sharedWorkerPlugin',
      'rtcDataChannelPlugin',
      'broadcastChannelPlugin',
      'serviceWorkerPlugin',
      'webTransportPlugin',
      'RpcBrowserErrorCode',
      'RPC_BROWSER_ERROR_SOURCE'
    ]
  }
}
/** Retires factories/claim-oriented helpers; ordinary operations now own each violation or state. */
const retiredSymbols: Record<string, readonly string[]> = {
  '@migaia/rpc/contract': ['invalidRpcStream'],
  '@migaia/rpc/contract/v1': ['invalidRpcStream', 'default'],
  '@migaia/rpc/contract/framing': [
    'rejectRpcPhysicalFrameSize',
    'createReassembler',
    'processStringFramer'
  ],
  /** Core constructors are internal except the real caller-owned lifecycle error use. */
  '@migaia/rpc/core': [
    'createAuthenticationNonce',
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
  prepareRpcBinary: '@migaia/rpc-contract/binary/lazy',
  readRpcNativeBinary: '@migaia/rpc-contract/binary/inspect',
  readRuntimeCarrier: '@migaia/rpc-contract/runtime',
  restoreRpcBinary: '@migaia/rpc-contract/binary/lazy',
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

describe('merged public exports', () => {
  it('rpc-host integration boundary: preserves the merged runtime export sets and the layered transport kit', async () => {
    /** These independently reviewed publication paths are not read from the generated registry. */
    const expectedPaths: Record<string, readonly string[]> = {
      'rpc-contract': [
        '.',
        './v1',
        './framing',
        './framing/v1',
        './framing/stream',
        './wire',
        './portable',
        './errors',
        './schema/wire-error',
        './runtime',
        './runtime/metadata',
        './runtime/lazy',
        './binary/inspect',
        './framing/jsonrpc',
        './binary/lazy',
        './stream',
        './remote'
      ],
      'rpc-host': [
        '.',
        './probe',
        './plugin',
        './features',
        './features/auth',
        './features/chunk',
        './features/retry',
        './features/timeout',
        './features/typegen'
      ],
      'rpc-plugin-process': [
        '.',
        './features',
        './features/send-queue',
        './features/log',
        './features/flow-control'
      ],
      'rpc-plugin-thread': ['.'],
      'rpc-plugin-browser': ['.'],
      'rpc-plugin-coroutines': ['.'],
      'rpc-plugin-pool': ['.'],
      'rpc-plugin-devtools': ['.']
    }
    /** Every current owner must resolve its actual built runtime and declaration entry. */
    const manifests = Object.fromEntries(
      Object.keys(expectedPaths).map((owner) => [
        owner,
        JSON.parse(readFileSync(join(packageRoot, owner, 'package.json'), 'utf8')) as {
          exports: Record<string, { default: string; types: string }>
        }
      ])
    )
    for (const [owner, expected] of Object.entries(expectedPaths)) {
      expect(orderStringKeys(Object.keys(manifests[owner]!.exports)), owner).toEqual(
        orderStringKeys([...expected])
      )
      for (const [key, entry] of Object.entries(manifests[owner]!.exports)) {
        expect(existsSync(join(packageRoot, owner, entry.default)), `${owner}:${key}`).toBe(true)
        if (key !== './schema/wire-error') {
          expect(entry.types).toBe(entry.default.replace(/\.js$/, '.d.ts'))
          expect(existsSync(join(packageRoot, owner, entry.types)), `${owner}:${key}`).toBe(true)
        }
      }
    }
    const manifest = manifests['rpc-host']!
    for (const [name, baseline] of Object.entries(legacyExports)) {
      // Contract vocabulary retains its original behavior oracle; factory removals have new checks.
      if (!name.startsWith('@migaia/rpc/contract')) continue
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
        orderStringKeys(Object.keys(await import(pathToFileURL(join(ownerRoot, relative)).href))),
        name
      ).toEqual(
        orderStringKeys(
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
                  !(
                    (controlSemanticsDelta.removed as Record<string, string[]>)[name] ?? []
                  ).includes(item)
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
                ? [
                    'processStringFramer',
                    'remoteProcessStringFramer',
                    'inspectRpcPhysicalFrame',
                    'rpcByteRuntimeBootstrap'
                  ]
                : []),
              ...((coreRefactorDelta.added as Record<string, string[]>)[name] ?? [])
            ])
          ].filter((item) => !(retiredSymbols[name] ?? []).includes(item))
        )
      )
      // A leaf export maps to its own source path; index entries map to directory roots.
      expect(relative, name).toBe(expectedRelative)
    }
    /** Actual built Host files remain independently checked below the narrowed package boundary. */
    const coreRoot = join(packageRoot, 'rpc-host')
    /** Canonical streaming remains an internal Host owner, with no application factory path. */
    expect(manifest.exports).not.toHaveProperty('./stream')
    /** SDK descriptions use the original contract vocabulary without publishing old assemblies. */
    const remoteNamespace = await import('@migaia/rpc-host/plugin')
    /** Every ordinary entry retains an exact namespace, with no claimed preparation exports. */
    for (const [owner, entries] of Object.entries(ordinaryEntries)) {
      for (const [key, names] of Object.entries(entries)) {
        const entry = manifests[owner]!.exports[key]!
        const ownerRoot = join(packageRoot, owner)
        expect(existsSync(join(ownerRoot, entry.types)), `${owner}:${key}`).toBe(true)
        expect(
          orderStringKeys(
            Object.keys(await import(pathToFileURL(join(ownerRoot, entry.default)).href))
          ),
          `${owner}:${key}`
        ).toEqual(orderStringKeys([...names]))
      }
    }
    for (const [symbol, module] of Object.entries(formerProtocolOperations))
      expect(await import(module), symbol).toHaveProperty(symbol)
    /** Exposes only scalar metadata from the existing owner, without its family tokens. */

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
    expect(framing.JSONRPC_BRIDGE_ERROR_SOURCE).toBe('rpc.contract.jsonrpc')
    expect(Object.keys(framing.JsonRpcBridgeErrorCode)).toHaveLength(5)
    /** The process root publishes one native transport factory and stable error identities. */
    const processEntry = manifests['rpc-plugin-process']!.exports['.']!
    expect(
      orderStringKeys(
        Object.keys(
          await import(
            pathToFileURL(join(packageRoot, 'rpc-plugin-process', processEntry.default)).href
          )
        )
      )
    ).toEqual([
      'RPC_PROCESS_ERROR_SOURCE',
      'RpcProcessErrorCode',
      'isProcessChild',
      'processPlugin'
    ])
    /** Both redundant factory names were removed instead of retained as aliases. */
    const processNamespace = await import('@migaia/rpc-plugin-process')
    expect(processNamespace).not.toHaveProperty('createJsonRpcAdapterChannel')
    expect(processNamespace).not.toHaveProperty('createJsonRpcRemoteChannel')
    /** Moved raw native operations belong to the already-public native adapter entries. */
    const nodeProcesses =
      await import('../../../rpc-plugin-process/dist/process/adapters/node-child-process.js')
    expect(orderStringKeys(Object.keys(nodeProcesses))).toEqual(
      orderStringKeys([
        'createAdapterChildStdio',
        'createAdapterNodeProcessLaunch',
        'createAdapterProcessStdio',
        'createNodeProcessLauncher',
        'openProcessStdioChannel'
      ])
    )
    /** The socket adapter owns its actual held native stream constructor. */
    const nodeSockets =
      await import('../../../rpc-plugin-process/dist/process/adapters/node-socket.js')
    expect(orderStringKeys(Object.keys(nodeSockets))).toEqual(
      orderStringKeys([
        'createAdapterSocketByteIO',
        'dialProcessByteChannel',
        'listenProcessByteChannel'
      ])
    )
    /** Removes text/constructor/lazy aliases without weakening the exact ordinary namespaces. */
    for (const [owner, entries] of Object.entries(manifests)) {
      for (const [key, entry] of Object.entries(entries.exports)) {
        if ((owner === 'rpc-contract' && key === './schema/wire-error') || key === './plugin')
          continue
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
    const threads = await import('@migaia/rpc-plugin-thread')
    /** Applications see one native transport factory and its original diagnostics. */
    expect(orderStringKeys(Object.keys(threads))).toEqual(
      orderStringKeys([
        'RPC_THREAD_ERROR_SOURCE',
        'RpcThreadErrorCode',
        'isThreadChild',
        'threadPlugin'
      ])
    )
    /** The moved Node channel factory uses its already-public native-owner entry. */
    const nodeThreads = await import('../../../rpc-plugin-thread/dist/threads/adapters/node.js')
    expect(orderStringKeys(Object.keys(nodeThreads))).toEqual(
      orderStringKeys(['createNodeThreadChannelFactory', 'createNodeThreadLauncher'])
    )
    expect(threads.RPC_THREAD_ERROR_SOURCE).toBe('rpc.transport.thread')
    expect(threads.RpcThreadErrorCode.usageSampleFailed).toBe('THREAD_USAGE_SAMPLE_FAILED')
  })

  it('publishes coroutine admission and factory only from its owning package', async () => {
    /** One cooperative transport owns the moved task types and its native source admission code. */
    const coroutine = await import('@migaia/rpc-plugin-coroutines')
    expect(orderStringKeys(Object.keys(coroutine))).toEqual([
      'RPC_COROUTINE_ERROR_SOURCE',
      'RpcCoroutineErrorCode',
      'coroutinePlugin'
    ])
    expect(coroutine.RPC_COROUTINE_ERROR_SOURCE).toBe('rpc.transport.coroutine')
    /** Neither ordinary applications nor native authors obtain a reverse coroutine factory. */
    expect(await import('@migaia/rpc-host')).not.toHaveProperty('createCoroutinePlugin')
    expect(await import('@migaia/rpc-host/plugin')).not.toHaveProperty('createCoroutinePlugin')
  })

  it('exports the browser plugin root with its retained carrier factories', async () => {
    /** This direct-consumer oracle remains independent from the earlier whole-family migration. */
    const root = join(packageRoot, 'rpc-plugin-browser')
    /** The root contains every supported browser plugin factory. */
    const expected = ordinaryEntries['rpc-plugin-browser']!
    /** Actual package exports select built modules; source imports cannot satisfy this boundary. */
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports: Record<string, { default: string; types: string }>
    }
    expect(orderStringKeys(Object.keys(manifest.exports))).toEqual(
      orderStringKeys(Object.keys(expected))
    )
    for (const [entry, names] of Object.entries(expected)) {
      const target = manifest.exports[entry]!
      expect(target.types).toBe(target.default.replace(/\.js$/, '.d.ts'))
      expect(existsSync(join(root, target.types))).toBe(true)
      const namespace = await import(pathToFileURL(join(root, target.default)).href)
      expect(orderStringKeys(Object.keys(namespace)), entry).toEqual(orderStringKeys([...names]))
    }
  })

  it('rpc-host integration boundary: exports the runtime coroutine plugin and removes the legacy host', async () => {
    /** Cooperative physical assembly is owned only by its transport package. */
    const root = await import('@migaia/rpc-plugin-coroutines')
    const canonical = await import('../../../rpc-plugin-coroutines/dist/coroutine-plugin.js')
    expect(root.coroutinePlugin).toBe(canonical.coroutinePlugin)
    for (const entry of [
      await import('@migaia/rpc-host'),
      await import('@migaia/rpc-host/plugin')
    ]) {
      expect(entry).not.toHaveProperty('createCoroutinePlugin')
      expect(entry).not.toHaveProperty('createCoroutineHost')
    }
    expect(
      existsSync(join(packageRoot, 'rpc-host/dist/remote/runtime-api/coroutine-plugin.js'))
    ).toBe(false)
  })

  it('keeps contract protocol and normalizer implementations outside compiled core', () => {
    expect(existsSync(join(packageRoot, './rpc-host/dist/core'))).toBe(true)
    expect(existsSync(join(packageRoot, './rpc-contract/dist/contract'))).toBe(true)
    const offenders = compiledCoreFiles(join(packageRoot, './rpc-host/dist/core')).filter(
      (path) => {
        const source = readFileSync(path, 'utf8')
        return /(?:function|const|class)\s+(?:rpcProtocolV1|normalizeRpcEnvelope)\b/.test(source)
      }
    )
    expect(offenders).toEqual([])
  })
})
