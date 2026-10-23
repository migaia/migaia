import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { defineFeaturePlugin, type IRpcFeaturePlugin } from '@migaia/rpc-host/plugin'
import { timeoutFeature } from '@migaia/rpc-host/features'
import timeout from '@migaia/rpc-host/features/timeout'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { coroutinePlugin, type ICoroutineConnect } from '@migaia/rpc-plugin-coroutines'
import { poolPlugin, type IRpcPoolControls } from '@migaia/rpc-plugin-pool'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

// @ts-expect-error Complete endpoint factories are not a public Host entry.
import { createEndpoint } from '@migaia/rpc-host'
// @ts-expect-error Full endpoint presets remain private kernel owners.
import { createFullEndpoint } from '@migaia/rpc-host'
// @ts-expect-error One-way endpoint construction is not a second public entry.
import { createFullOneWayEndpoint } from '@migaia/rpc-host'
// @ts-expect-error Runtime Peer construction is private to the canonical Host owner.
import { createRuntimePeer } from '@migaia/rpc-host/plugin'
// @ts-expect-error Managed Peer construction remains private to native orchestration.
import { createManagedRuntimePeer } from '@migaia/rpc-host/plugin'
// @ts-expect-error The legacy runtime plugin is replaced by registered transport definitions.
import { createRuntimePlugin } from '@migaia/rpc-host/plugin'
// @ts-expect-error Remote host construction remains private to protocol regressions.
import { createRemoteHost } from '@migaia/rpc-host/plugin'
// @ts-expect-error Remote plugin construction is not a user or author public entry.
import { createRemotePlugin } from '@migaia/rpc-host/plugin'
// @ts-expect-error Standalone serve constructors remain private to protocol owners.
import { serveRemoteHost } from '@migaia/rpc-host/plugin'
// @ts-expect-error Standalone serve constructors remain private to protocol owners.
import { serveRemotePlugin } from '@migaia/rpc-host/plugin'
// @ts-expect-error Endpoint preset subpaths no longer compete with createRpcHost.
import { createComposedEndpoint } from '@migaia/rpc-host/composed'
// @ts-expect-error Endpoint preset subpaths no longer compete with createRpcHost.
import { createClientEndpoint } from '@migaia/rpc-host/client'
// @ts-expect-error Endpoint preset subpaths no longer compete with createRpcHost.
import { createProviderEndpoint } from '@migaia/rpc-host/provider'
// @ts-expect-error Endpoint preset subpaths no longer compete with createRpcHost.
import { createFullEndpoint as fullPreset } from '@migaia/rpc-host/full'

/** The packed Host surface correlates a direct target with its actual scalar and stream methods. */
type IWorkerApi = Readonly<{
  echo(value: number): number
  values(value: number): AsyncIterable<number>
}>
/** Target names belong to the application declaration, independently of transport construction. */
declare const host: IRpcHost<Readonly<{ worker: IWorkerApi }>>
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
  const scalar: number = await host.send('worker', 'echo', 21)
  void scalar
  // @ts-expect-error An undeclared direct target cannot borrow another target's surface.
  host.send('another', 'echo', 21)
  // @ts-expect-error A scalar payload is not replaced by an unrelated string.
  host.send('worker', 'echo', 'wrong')
  // @ts-expect-error The iterable declaration cannot be invoked through a scalar call.
  host.send('worker', 'values', 1)
  /** The same timeout definition supports the aggregate and individual feature imports. */
  const features: readonly IRpcFeaturePlugin[] = [
    timeoutFeature({ ms: 1000 }),
    timeout({ ms: 1000 })
  ]
  /** Author definitions remain the explicit SDK boundary instead of endpoint constructors. */
  const authorFeature = defineFeaturePlugin({ name: 'packed-author-feature' })
  /** A pool definition exposes the original installation-specific controls. */
  const pool = poolPlugin({ size: 3 })
  /** Controls use the actual Host identity and preserve their own terminal stats/close surface. */
  const controls: IRpcPoolControls = pool.controls(host)
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
  const created: IRpcHost<IWorkerApi> = await createRpcHost<IWorkerApi>({
    plugins: [processPlugin({ spawn: './worker.mjs' }), timeoutFeature({ ms: 1000 })]
  })
  await created.close()
}
void verifyPackedHostContracts
