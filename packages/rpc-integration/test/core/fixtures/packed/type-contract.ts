/**
 * Compile public RPC archive contracts; namespace and complete feature types are the actual
 * consumer boundary.
 */
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcCallFeature } from '@migaia/rpc-contract/interfaces'
import { timeoutFeature as namedTimeout, retryFeature } from '@migaia/rpc-host/features'
import timeout from '@migaia/rpc-host/features/timeout'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { coroutinePlugin, type ICoroutineConnect } from '@migaia/rpc-plugin-coroutines'
import { pool, type IRpcPoolControls } from '@migaia/rpc-plugin-pool'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

// @ts-expect-error Complete endpoint factories are not a public Host entry.
import { createEndpoint } from '@migaia/rpc-host'
// @ts-expect-error Full endpoint presets were deleted by .
import { createFullEndpoint } from '@migaia/rpc-host'
// @ts-expect-error One-way endpoint construction is not a second public entry.
import { createFullOneWayEndpoint } from '@migaia/rpc-host'
// @ts-expect-error Per-session Peer constructors were deleted by .
import { createRuntimePeer } from '@migaia/rpc-host/sdk'
// @ts-expect-error Managed Peer constructors were deleted by .
import { createManagedRuntimePeer } from '@migaia/rpc-host/sdk'
// @ts-expect-error The legacy runtime plugin is replaced by registered transport definitions.
import { createRuntimePlugin } from '@migaia/rpc-host/sdk'
// @ts-expect-error Remote host constructors were deleted by .
import { createRemoteHost } from '@migaia/rpc-host/sdk'
// @ts-expect-error Remote plugin construction is not a user or author public entry.
import { createRemotePlugin } from '@migaia/rpc-host/sdk'
// @ts-expect-error Standalone serve constructors were deleted by .
import { serveRemoteHost } from '@migaia/rpc-host/sdk'
// @ts-expect-error Standalone serve constructors were deleted by .
import { serveRemotePlugin } from '@migaia/rpc-host/sdk'
// @ts-expect-error Endpoint preset subpaths no longer compete with createRpcHost.
import { createComposedEndpoint } from '@migaia/rpc-host/composed'
// @ts-expect-error Endpoint preset subpaths no longer compete with createRpcHost.
import { createClientEndpoint } from '@migaia/rpc-host/client'
// @ts-expect-error Endpoint preset subpaths no longer compete with createRpcHost.
import { createProviderEndpoint } from '@migaia/rpc-host/provider'
// @ts-expect-error Endpoint preset subpaths no longer compete with createRpcHost.
import { createFullEndpoint as fullPreset } from '@migaia/rpc-host/full'

/** Forwarding keeps every moved contract type equal to its canonical declaration. */
import type * as IHostContract from '@migaia/rpc-host/contract'
import type * as ICanonicalErrors from '@migaia/rpc-contract/errors'
import type * as ICanonicalPortable from '@migaia/rpc-contract/portable'

/** Generic identity comparison checks aliases without widening either contract shape. */
type IEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
/** A failed equality is a declaration-check failure, not a runtime approximation. */
type IAssertSame<T extends true> = T
/** All fifteen moved error types plus the portable value preserve their original definitions. */
type IContractTypesMatch = IAssertSame<
  IEqual<
    [
      IHostContract.RpcError,
      IHostContract.RpcSchemaValidationError,
      IHostContract.RpcConfigurationError,
      IHostContract.RpcConstructionError,
      IHostContract.RpcSerializationError,
      IHostContract.RpcProtocolError,
      IHostContract.RpcContractError,
      IHostContract.RpcTransportError,
      IHostContract.RpcAuthenticationError,
      IHostContract.RpcChunkError,
      IHostContract.RpcRemoteError,
      IHostContract.RpcAbortError,
      IHostContract.RpcTimeoutError,
      IHostContract.IRpcError,
      IHostContract.IRpcCleanupError,
      IHostContract.IRpcPortableValue
    ],
    [
      ICanonicalErrors.RpcError,
      ICanonicalErrors.RpcSchemaValidationError,
      ICanonicalErrors.RpcConfigurationError,
      ICanonicalErrors.RpcConstructionError,
      ICanonicalErrors.RpcSerializationError,
      ICanonicalErrors.RpcProtocolError,
      ICanonicalErrors.RpcContractError,
      ICanonicalErrors.RpcTransportError,
      ICanonicalErrors.RpcAuthenticationError,
      ICanonicalErrors.RpcChunkError,
      ICanonicalErrors.RpcRemoteError,
      ICanonicalErrors.RpcAbortError,
      ICanonicalErrors.RpcTimeoutError,
      ICanonicalErrors.IRpcError,
      ICanonicalErrors.IRpcCleanupError,
      ICanonicalPortable.IRpcPortableValue
    ]
  >
>
/** Type evidence is consumed only during the packed declaration check. */
declare const contractTypesMatch: IContractTypesMatch
void contractTypesMatch
// @ts-expect-error removes contract types from the Host root.
import type { RpcError as IRemovedRpcError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcSchemaValidationError as IRemovedRpcSchemaValidationError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcConfigurationError as IRemovedRpcConfigurationError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcConstructionError as IRemovedRpcConstructionError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcSerializationError as IRemovedRpcSerializationError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcProtocolError as IRemovedRpcProtocolError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcContractError as IRemovedRpcContractError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcTransportError as IRemovedRpcTransportError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcAuthenticationError as IRemovedRpcAuthenticationError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcChunkError as IRemovedRpcChunkError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcRemoteError as IRemovedRpcRemoteError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcAbortError as IRemovedRpcAbortError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { RpcTimeoutError as IRemovedRpcTimeoutError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { IRpcError as IRemovedIRpcError } from '@migaia/rpc-host'
// @ts-expect-error removes contract types from the Host root.
import type { IRpcCleanupError as IRemovedIRpcCleanupError } from '@migaia/rpc-host'
/** Negative root imports remain used so missing exports supply the actual diagnostic. */
type IRemovedContractBindings = [
  IRemovedRpcError,
  IRemovedRpcSchemaValidationError,
  IRemovedRpcConfigurationError,
  IRemovedRpcConstructionError,
  IRemovedRpcSerializationError,
  IRemovedRpcProtocolError,
  IRemovedRpcContractError,
  IRemovedRpcTransportError,
  IRemovedRpcAuthenticationError,
  IRemovedRpcChunkError,
  IRemovedRpcRemoteError,
  IRemovedRpcAbortError,
  IRemovedRpcTimeoutError,
  IRemovedIRpcError,
  IRemovedIRpcCleanupError
]
/** Compile-only consumption never executes a removed root value. */
declare const removedContractBindings: IRemovedContractBindings
void removedContractBindings

/** The packed Host surface correlates a direct target with its actual scalar and stream methods. */
type IWorkerApi = Readonly<{
  echo(value: number): number
  values(value: number): AsyncIterable<number>
}>
/** Target names belong to the application declaration, independently of transport construction. */
declare const host: IRpcHost<
  Readonly<{ worker: IWorkerApi }>,
  readonly [ReturnType<typeof processPlugin<'process'>>]
>
/** This opaque connection is supplied by the actual coroutine task, never forged by a consumer. */
declare const connect: ICoroutineConnect

/** Compile every final user entry without executing a native acquisition during type checking. */
async function verifyPackedHostContracts(): Promise<void> {
  /** Negative imports are compile-only evidence; no retired constructor is invoked. */
  void [
    createEndpoint,
    createFullEndpoint,
    createFullOneWayEndpoint,
    createRuntimePeer,
    createManagedRuntimePeer,
    createRuntimePlugin,
    createRemoteHost,
    createRemotePlugin,
    serveRemoteHost,
    serveRemotePlugin,
    createComposedEndpoint,
    createClientEndpoint,
    createProviderEndpoint,
    fullPreset
  ]
  /** Explicit direct calls retain the declared scalar result. */
  const scalar: number = await host.process.send('worker', 'echo', 21)
  void scalar
  // @ts-expect-error An undeclared direct target cannot borrow another target's surface.
  host.process.send('another', 'echo', 21)
  // @ts-expect-error A scalar payload is not replaced by an unrelated string.
  host.process.send('worker', 'echo', 'wrong')
  // @ts-expect-error The iterable declaration cannot be invoked through a scalar call.
  host.process.send('worker', 'values', 1)
  /** The same timeout definition supports the aggregate and individual feature imports. */
  const features: Readonly<Record<string, IRpcCallFeature>> = {
    deadline: namedTimeout({ ms: 1000 }),
    replay: retryFeature({ attempts: 2 })
  }
  /**
   * The direct timeout entry keeps the same complete feature contract without a duplicate
   * installation.
   */
  const directTimeout: IRpcCallFeature = timeout({ ms: 1000 })
  void directTimeout
  /** Author definitions remain the explicit SDK boundary instead of endpoint constructors. */
  const authorFeature = defineFlowPlugin({
    name: 'packed-author-feature',
    setup: authorSetup
  })
  /** A pool definition exposes the original installation-specific controls. */
  const pooled = pool({ size: 3 })
  /** Controls use the actual Host identity and preserve their own terminal stats/close surface. */
  const pooledTransport = coroutinePlugin({ spawn: async () => undefined, features: { pooled } })
  /** Only this actual transport's projected namespace exposes installed pool controls. */
  const pooledHost = undefined as unknown as IRpcHost<IWorkerApi, readonly [typeof pooledTransport]>
  const controls: IRpcPoolControls = pooledHost.coroutine.pool
  void controls.stats()
  /** A collector is owned explicitly by its feature instance. */
  const devtools = devtoolsPlugin()
  void devtools.collector.stats()
  void [
    features,
    authorFeature,
    processPlugin({ spawn: './worker.mjs' }),
    threadPlugin({ spawn: './worker.mjs' })
  ]
  /** Browser carrier shells accept their actual native structural port. */
  const worker = undefined as unknown as Parameters<typeof dedicatedWorkerPlugin>[0]['worker']
  void dedicatedWorkerPlugin({ worker })
  void coroutinePlugin({ connectToParent: connect })
  /** Generic Host construction retains the caller's capability declaration. */
  const transport = processPlugin({ spawn: './worker.mjs', features })
  const created = await createRpcHost<
    IWorkerApi,
    readonly [typeof transport, typeof authorFeature]
  >({
    plugins: [transport, authorFeature]
  })
  /** Existing application extension values stay correlated with the installed namespace. */
  const nativeFoo: 1 = created.process.foo
  /** Literal result inference survives the real emitted author declarations. */
  const nativeBar: 'packed-bar' = created.process.bar()
  void [nativeFoo, nativeBar, created.process.custom()]
  // @ts-expect-error Unpublished native extension keys cannot appear on a namespace.
  void created.process.missingNativeKey
  await created.close()
  // @ts-expect-error Root call aliases were removed by .
  void created.request('echo', 1)
  // @ts-expect-error Per-call timeout accepts policy options or false, never a number.
  host.process.send('worker', 'echo', 1, { timeout: 100 })
  host.process.send('worker', 'echo', 1, {
    retry: {
      // @ts-expect-error Per-call retry rejects handwritten execution objects.
      kind: 'retry',
      run() {
        return Promise.resolve(1)
      }
    }
  })
  void host.process.send('worker', 'echo', 1, {
    timeout: false,
    retry: { attempts: 2 }
  })
}
void verifyPackedHostContracts

/** The real flow SDK owns setup; this compile-only application contributes a native extension. */
function authorSetup() {
  return { hooks: {}, namespaceExtensions: authorNamespaceExtensions }
}
/** These exact literal values retain the old application surface after namespace projection. */
function authorNamespaceExtensions() {
  return { foo: 1 as const, bar: () => 'packed-bar' as const, custom: () => 'packed-custom' }
}
