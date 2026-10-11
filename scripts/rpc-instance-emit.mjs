import ts from 'typescript'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/** Actual resource constructors are selected per mandatory runtime owner; registrars stay private. */
export const RPC_RESOURCE_POINTS = {
  '@migaia/rpc-contract': {
    'contract/framing/message-framer.ts': ['createStringFramer', 'createBinaryFramer'],
    'contract/framing/reassembler.ts': ['createReassembler'],
    'contract/framing/stream.ts': [
      'createRpcStreamFrameDecoder',
      'createRpcStreamFrameDecoderWithLimit'
    ],
    'contract/framing/handshake-receiver.ts': ['createRpcHandshakeFrameReceiver'],
    'contract/framing/bootstrap-receiver.ts': ['createRpcBootstrapFrameReceiver'],
    'contract/unknown-field.ts': ['createRpcUnknownFieldWarner'],
    'contract/contract-error.ts': ['createContractError'],
    'contract/portable-binary.ts': ['markRpcPortableBinary'],
    'contract/runtime-api/binary-operation.ts': ['prepareRpcBinary', 'captureRpcBinaryData'],
    'contract/runtime-api/binary-lazy-operation.ts': ['prepareRpcBinaryLazy'],
    'contract/runtime-api/binary.ts': ['restoreRpcBinary'],
    'contract/runtime-api/binary-lazy.ts': ['restoreRpcBinaryLazy'],
    'contract/batch-frame.ts': ['inspectRpcPhysicalFrame'],
    'contract/error.ts': ['deserializeRpcError'],
    'contract/framing/jsonrpc.ts': ['encodeJsonRpcFrame', 'createJsonRpcFrameDecoder']
  },
  '@migaia/rpc-core': {
    'runtime-adapter/message/resource.ts': [
      'AdapterMessageResource',
      'createEventEmitterMessageResource',
      'createEventTargetMessageResource'
    ],
    'runtime-adapter/byte/event-byte-io.ts': ['createRuntimeEventByteIO'],
    'runtime-adapter/byte/handshake.ts': ['createRuntimeByteConnection'],
    'runtime-adapter/byte/bootstrap.ts': ['readRuntimeByteBootstrap'],
    'runtime-adapter/byte/peer.ts': ['createAdapterBytePeer'],
    'runtime-adapter/message/connection.ts': ['createRuntimeMessageConnection'],
    'runtime-adapter/listener.ts': ['createAdapterListenerPreparation'],
    'runtime-adapter/byte/ipc-connection.ts': ['attachIpcConnection'],
    'runtime-adapter/object/connection.ts': ['holdAdapterObjectChannel'],
    'runtime-adapter/provider/governor.ts': ['createRuntimeProviderGovernor'],
    'runtime-adapter/provider/scope.ts': ['createRuntimeProviderScope'],
    'runtime-adapter/peer.ts': [
      'AdapterPeerPreparation',
      'prepareAdapterPeer',
      'holdAdapterLaunch'
    ],
    'runtime-adapter/binding.ts': [
      'createAdapterBindingDrain',
      'createAdapterPlugin',
      'holdAdapterRegistration'
    ],
    'core/composed.ts': ['createComposedEndpointRuntime'],
    'core/runtime-api-endpoint.ts': ['createRuntimeApiEndpoint'],
    'core/client.ts': ['createClientEndpointRuntime'],
    'core/provider.ts': ['createProviderEndpointRuntime'],
    'core/full.ts': ['createFullEndpointWithRoots'],
    'core/endpoint-kernel.ts': ['createEndpointKernel'],
    'core/idempotency-store.ts': ['createRpcIdempotencyStore'],
    'core/feature.ts': ['defineFeature'],
    'core/middleware.ts': ['defineMiddleware'],
    'core/internal/provider-admission.ts': ['createProviderAdmissionScope'],
    'core/internal/error-wire-metadata.ts': ['serializeRpcError', 'deserializeRpcError'],
    'core/internal/listener-safety.ts': ['createListenerFailureState'],
    'core/internal/message-listener-hub.ts': ['createMessageListenerHub'],
    'core/adapters/memory.ts': ['createMemoryTransportPair'],
    'core/adapters/message-port.ts': [
      'createBrowserMessagePortTransport',
      'createNodeMessagePortTransport'
    ],
    'core/adapters/web-worker.ts': ['createWebWorkerTransport'],
    'core/plugins/send-queue.ts': ['createIpcSendQueueTransport'],
    'remote/proxy.ts': [
      'createRemoteRegistration',
      'createRemoteRuntimeRegistration',
      'createRemoteGenerationHolder'
    ],
    'remote/plugin.ts': ['createRemotePlugin'],
    'remote/host.ts': ['createRemoteHost'],
    'remote/retry.ts': ['createRemoteRetryPort'],
    'remote/serve-host.ts': ['createRemoteHostControl', 'serveRemoteHost'],
    'remote/serve-plugin.ts': ['serveRemotePlugin'],
    'remote/coroutine.ts': ['coroutinePorts'],
    'remote/runtime-api/peer.ts': ['createRuntimePeer'],
    'remote/runtime-api/plugin.ts': ['createRuntimePlugin'],
    'remote/runtime-api/managed-peer.ts': ['createManagedRuntimePeer'],
    'remote/runtime-api/outlet.ts': ['createRuntimeOutlet'],
    'remote/runtime-api/events.ts': ['createRuntimeEventPublisher'],
    'testing/index.ts': ['createPeerPair']
  },
  '@migaia/rpc-process': {
    'process/node-io.ts': [
      'createAdapterChildStdio',
      'createAdapterProcessStdio',
      'createAdapterSocketByteIO'
    ],
    'process/node-launch.ts': ['createAdapterNodeProcessLaunch'],
    'process/launch.ts': ['AdapterProcessLaunch', 'createAdapterProcessLaunch'],
    'process/web-byte-stream.ts': ['webByteStream', 'createAdapterWebByteIO'],
    'process/node-byte-stream.ts': ['nodeByteStream'],
    'process/bootstrap.ts': ['receiveAdapterBootstrap'],
    'process/peer.ts': ['createAdapterProcessPeer', 'createProcessPeer'],
    'process/runtime-peer.ts': ['createProcessSourcePeer'],
    'process/runtime-listener.ts': ['createProcessListenerPeer'],
    'process/automatic-peer.ts': ['createAutomaticProcessPeer'],
    'process/plugin/operation.ts': ['createAdapterProcessPlugin'],
    'process/plugin/binding.ts': [
      'createSpawnProcessBinding',
      'createProcessConnectionSupervisor',
      'createConnectProcessBinding'
    ],
    'process/plugin/serve.ts': ['serveProcessSessions', 'createProcessSessionService'],
    'process/host/adopted-binding.ts': ['createAdoptedProcessBinding'],
    'process/host/registration.ts': ['adoptHostRegistration'],
    'process/resilience/index.ts': ['createProcessResilience'],
    'process/resilience/session.ts': ['createProcessSessionManager'],
    'process/resilience/provider-admission.ts': ['createProcessProviderAdmission'],
    'process/resilience/rendezvous.ts': ['listenProcessRegistrations'],
    'process/resilience/fallback.ts': ['createProcessInstanceFallback'],
    'process/resilience/terminal.ts': ['createProcessTerminalRegistration'],
    'process/stderr.ts': ['attachIpcStderr'],
    'process/object-channel.ts': ['openProcessObjectChannel'],
    'process/handshake.ts': ['createProcessTransport'],
    'process/plugin/client.ts': ['createProcessPlugin'],
    'process/adapters/node-child-process.ts': [
      'createNodeProcessLauncher',
      'openProcessStdioChannel'
    ],
    'process/adapters/deno-command.ts': ['createDenoProcessLauncher', 'openProcessStdioChannel'],
    'process/adapters/node-socket.ts': ['dialProcessByteChannel', 'listenProcessByteChannel'],
    'process/adapters/deno-socket.ts': ['dialProcessByteChannel', 'listenProcessByteChannel'],
    'process/adapters/electron-utility-process.ts': ['createElectronUtilityProcessLauncher'],
    'process/adapters/windows-job.ts': ['createWindowsJobProcessLauncher']
  },
  '@migaia/rpc-threads': {
    'threads/node-peer.ts': ['createAdapterNodeThreadPeer'],
    'threads/node-launcher.ts': [
      'createAdapterNodeThreadLauncher',
      'createAdapterNodeThreadChannelFactory'
    ],
    'threads/web-launcher.ts': [
      'createAdapterWebThreadLauncher',
      'createAdapterWebThreadChannelFactory'
    ],
    'threads/node-parent.ts': ['AdapterNodeThreadParentChannel'],
    'threads/channel.ts': ['createNodeThreadChannel', 'createWebThreadChannel'],
    'threads/bootstrap.ts': ['receiveThreadData'],
    'threads/peer.ts': ['createThreadPeer'],
    'threads/plugin.ts': ['createThreadPlugin'],
    'threads/adapters/node.ts': [
      'createNodeThreadLauncher',
      'createNodeThreadChannelFactory',
      'borrowNodeThreadParent'
    ],
    'threads/adapters/web.ts': ['createWebThreadLauncher', 'createWebThreadChannelFactory']
  },
  '@migaia/rpc-bridge-jsonrpc': {
    'bridge/jsonrpc/index.ts': ['createJsonRpcRemoteChannel'],
    'bridge/jsonrpc/channel.ts': ['createJsonRpcAdapterChannel'],
    'bridge/jsonrpc/transport.ts': ['bindJsonRpcWire']
  },
  '@migaia/rpc-browser': {
    'browser/adapters/window.ts': ['createWindowMessageTransport'],
    'browser/adapters/shared-worker.ts': ['createSharedWorkerTransport'],
    'browser/adapters/service-worker.ts': ['createServiceWorkerTransport'],
    'browser/adapters/broadcast-channel.ts': ['createBroadcastChannelTransport'],
    'browser/adapters/web-transport.ts': ['createWebTransportDatagramTransport'],
    'browser/adapters/rtc-data-channel.ts': ['createRtcDataChannelTransport']
  }
}

/** Reads the existing canonical literal declaration; this hook creates no second code/text table. */
function canonicalLiteral(file, declarationName, propertyName) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let value
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === declarationName) {
      let expression = node.initializer
      while (expression && (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)))
        expression = expression.expression
      if (propertyName === undefined && expression && ts.isStringLiteral(expression))
        value = expression.text
      if (expression && ts.isObjectLiteralExpression(expression))
        for (const property of expression.properties)
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText(source) === propertyName &&
            ts.isStringLiteral(property.initializer)
          )
            value = property.initializer.text
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (typeof value !== 'string')
    throw new Error(
      `Missing canonical RPC literal: ${file}#${declarationName}.${propertyName ?? ''}`
    )
  return value
}

/** One compiler-created private module per real package path; loading it never claims the realm. */
function bootstrapSource(name, version, identity) {
  return `/** Generated by scripts/dist-stamp.mjs from Core canonical declarations; private build output. */
/** The final published owner name selects only its own realm collision slot. */
const owner = ${JSON.stringify(name)}
/** Lockstep manifest version participates in collision detection without granting authority. */
const version = ${JSON.stringify(version)}
/** This private object identifies one real module evaluation and cannot be copied by labels. */
const instance = Object.freeze({})
/** A successful immutable realm registration is checked only once for this module instance. */
let admitted = false
/** Symbol.for shares detection across resolved copies while each Worker retains its own global. */
const realmKey = Symbol.for('@migaia/rpc/module-instance/' + owner)
/** Only immutable version and module identity facts live in the collision marker. */
type IRegistration = Readonly<{ version: string; instance: object }>
/** Detects collisions only; this marker grants no admission, lifetime or transport capability. */
export function assertRpcModuleInstance(): void {
  if (admitted) return
  /** One realm-local global object owns the detector; no RPC registry is moved into it. */
  const realm = globalThis as unknown as Record<symbol, IRegistration | undefined>
  /** Existing first-owner registration is compared without changing its resource state. */
  const current = realm[realmKey]
  if (current === undefined) {
    Object.defineProperty(realm, realmKey, {
      value: Object.freeze({ version, instance }),
      configurable: false,
      enumerable: false,
      writable: false
    })
    admitted = true
    return
  }
  if (current.version === version && current.instance === instance) {
    admitted = true
    return
  }
  /** Native Error keeps its own stack; generated identity literals come only from canonical Core. */
  const error = new Error(${JSON.stringify(identity.text)})
  Object.defineProperties(error, {
    source: { value: ${JSON.stringify(identity.source)}, enumerable: true },
    code: { value: ${JSON.stringify(identity.code)}, enumerable: true }
  })
  throw error
}
`
}

/** Exact AST declarations receive one entry check; original nodes retain compiler map positions. */
function resourceTransformer(packageDirectory, points, virtualFile) {
  return (context) => (source) => {
    const file = relative(join(packageDirectory, 'src'), source.fileName).replaceAll('\\', '/')
    const expected = new Set(points[file] ?? [])
    if (expected.size === 0) return source
    const factory = context.factory
    const call = () =>
      factory.createExpressionStatement(
        factory.createCallExpression(
          factory.createIdentifier('assertRpcModuleInstance'),
          undefined,
          []
        )
      )
    const checkedBody = (body) =>
      ts.isBlock(body)
        ? factory.updateBlock(body, [call(), ...body.statements])
        : factory.createBlock([call(), factory.createReturnStatement(body)], true)
    const visit = (node) => {
      if (ts.isClassDeclaration(node) && node.name && expected.has(node.name.text)) {
        /** A held-resource class checks before its constructor acquires listeners or owner state. */
        const constructor = node.members.find(ts.isConstructorDeclaration)
        if (constructor?.body) {
          expected.delete(node.name.text)
          return factory.updateClassDeclaration(
            node,
            node.modifiers,
            node.name,
            node.typeParameters,
            node.heritageClauses,
            node.members.map((member) =>
              member === constructor
                ? factory.updateConstructorDeclaration(
                    constructor,
                    constructor.modifiers,
                    constructor.parameters,
                    checkedBody(constructor.body)
                  )
                : member
            )
          )
        }
      }
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        node.body &&
        expected.has(node.name.text)
      ) {
        expected.delete(node.name.text)
        return factory.updateFunctionDeclaration(
          node,
          node.modifiers,
          node.asteriskToken,
          node.name,
          node.typeParameters,
          node.parameters,
          node.type,
          checkedBody(node.body)
        )
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        expected.has(node.name.text)
      ) {
        const expression = node.initializer
        if (ts.isArrowFunction(expression)) {
          expected.delete(node.name.text)
          return factory.updateVariableDeclaration(
            node,
            node.name,
            node.exclamationToken,
            node.type,
            factory.updateArrowFunction(
              expression,
              expression.modifiers,
              expression.typeParameters,
              expression.parameters,
              expression.type,
              expression.equalsGreaterThanToken,
              checkedBody(expression.body)
            )
          )
        }
      }
      return ts.visitEachChild(node, visit, context)
    }
    const updated = ts.visitEachChild(source, visit, context)
    if (expected.size)
      throw new Error(`Unmatched RPC resource declaration: ${file}: ${[...expected].join(', ')}`)
    let specifier = relative(dirname(source.fileName), virtualFile)
      .replaceAll('\\', '/')
      .replace(/\.ts$/, '.js')
    if (!specifier.startsWith('.')) specifier = './' + specifier
    const statement = factory.createImportDeclaration(
      undefined,
      factory.createImportClause(
        false,
        undefined,
        factory.createNamedImports([
          factory.createImportSpecifier(
            false,
            undefined,
            factory.createIdentifier('assertRpcModuleInstance')
          )
        ])
      ),
      factory.createStringLiteral(specifier),
      undefined
    )
    return factory.updateSourceFile(updated, [statement, ...updated.statements])
  }
}

/**
 * RPC-only replacement for the existing tsc command in the dist-stamp build CLI. Emit owns
 * injection and maps together; source fixtures do not constitute BCPS1 evidence.
 *
 * @param {string} directory Absolute final RPC owner directory.
 * @returns {number} Native compiler-style exit status; never stamps failed output.
 */
export function emitRpcWithInstanceGuard(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (!(manifest.name in RPC_RESOURCE_POINTS))
    throw new Error('RPC instance emission requires one declared runtime owner')
  const coreSource = join(
    directory,
    manifest.name === '@migaia/rpc-core' ? 'src/core' : '../rpc-core/src/core'
  )
  const identity = {
    source: canonicalLiteral(join(coreSource, 'error-code.ts'), 'ERROR_SOURCE'),
    code: canonicalLiteral(
      join(coreSource, 'error-code.ts'),
      'RpcCoreErrorCode',
      'duplicateModuleInstance'
    ),
    text: canonicalLiteral(
      join(coreSource, 'error-text.ts'),
      'RpcCoreErrorText',
      'duplicateModuleInstance'
    )
  }
  const configFile = join(directory, 'tsconfig.build.json')
  const read = ts.readConfigFile(configFile, ts.sys.readFile)
  if (read.error) {
    console.error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
    return 2
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    directory,
    undefined,
    configFile
  )
  const options = { ...parsed.options, sourceMap: true, inlineSources: true }
  const virtualFile = resolve(directory, 'src/internal/module-instance.ts')
  const virtualText = bootstrapSource(manifest.name, manifest.version, identity)
  const host = ts.createCompilerHost(options)
  const readFile = host.readFile
  const fileExists = host.fileExists
  const getSourceFile = host.getSourceFile
  host.readFile = (file) => (resolve(file) === virtualFile ? virtualText : readFile(file))
  host.fileExists = (file) => resolve(file) === virtualFile || fileExists(file)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(file) === virtualFile
      ? ts.createSourceFile(file, virtualText, languageVersion, true)
      : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
  /** The generated helper has no public declaration consumer; do not publish a dangling map. */
  const writeFile = host.writeFile
  host.writeFile = (file, data, writeByteOrderMark, onError, sourceFiles) => {
    if (
      sourceFiles?.some((source) => resolve(source.fileName) === virtualFile) &&
      (file.endsWith('.d.ts') || file.endsWith('.d.ts.map'))
    )
      return
    writeFile(file, data, writeByteOrderMark, onError, sourceFiles)
  }
  const points = RPC_RESOURCE_POINTS[manifest.name]
  for (const file of Object.keys(points))
    if (!existsSync(join(directory, 'src', file)))
      throw new Error(`Missing RPC resource owner: ${file}`)
  const program = ts.createProgram({
    rootNames: [...parsed.fileNames, virtualFile],
    projectReferences: parsed.projectReferences,
    options,
    host
  })
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  const emit = program.emit(undefined, undefined, undefined, undefined, {
    before: [resourceTransformer(directory, points, virtualFile)]
  })
  diagnostics.push(...emit.diagnostics)
  if (diagnostics.length)
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: () => directory,
        getNewLine: () => '\n'
      })
    )
  return diagnostics.length || emit.emitSkipped ? 2 : 0
}
