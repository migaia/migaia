import { type INodeThreadHandle } from '../../dist/threads/node-launcher.js'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import type { IThreadHandle } from '@migaia/supervision/threads'
import { fileURLToPath } from 'node:url'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/public-host.js'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createComposedEndpoint } from '../../../rpc-host/dist/core/composed.js'
import { createCanonicalChunkFeature } from '@migaia/rpc-host/stream'
import { createOutboundFeature } from '../../../rpc-host/dist/core/features/outbound.js'
import { createProviderFeature } from '../../../rpc-host/dist/core/features/provider.js'
import { createStreamFeature } from '@migaia/rpc-host/stream'
import { createControlFeature } from '../../../rpc-host/dist/core/features/control.js'
import { createDiscoveryFeature } from '../../../rpc-host/dist/core/features/discovery.js'
import { abort } from '../../../rpc-host/dist/core/middleware/abort.js'
import { codec } from '../../../rpc-host/dist/core/middleware/codec.js'
import { framer } from '../../../rpc-host/dist/core/middleware/framer.js'
import { connect } from '../../../rpc-host/dist/core/middleware/connect.js'
import { ping } from '../../../rpc-host/dist/core/middleware/ping.js'
import type { IRpcEndpoint } from '../../../rpc-host/dist/core/typing.js'
import { createOneWayFeature } from '../../../rpc-host/dist/core/features/one-way.js'
import type { IRuntimeDynamicSurface } from '@migaia/rpc-host/plugin'
import type { IRemoteContract } from '@migaia/rpc-host/plugin'
import type { IRemoteEndpointFactory } from '@migaia/rpc-host/plugin'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'

import type { IRuntimeThreadSpawn } from '../../src/threads/runtime-peer.js'

import { assembleAdapterPlugin } from '../../../rpc-host/dist/runtime-adapter/definition.js'
import type { IRuntimePluginOptions } from '../../../rpc-host/dist/remote/runtime-api/plugin.js'
import type {
  IRuntimePluginTyping,
  IRuntimeExpose,
  IRuntimeRegistry,
  IRuntimePeerProvide
} from '@migaia/rpc-host/plugin'
import { RuntimePluginKey } from '@migaia/rpc-host/plugin'
import { createThreadPeer } from '../protocol.js'
import { threadRuntimeResource } from '../../dist/threads/runtime-resource.js'
import { getThreadMessageAdapter } from '../../dist/threads/adapter.js'
import type { IThreadRuntimeResource } from '../../dist/threads/runtime-types.js'
import type { IRuntimeThreadPeerOptions } from '../../dist/threads/runtime-peer.js'

/**
 * Existing lower-owner tests share one original thread slot, without exporting a production
 * factory.
 */
const fixtureThreadFamily = Object.freeze({})

/** Endpoint/runtime injection stays confined to the original lower-owner fixture grammar. */
export type IThreadFixturePluginOptions = Omit<
  IRuntimePluginOptions<IRuntimeThreadPeerOptions['spawn']>,
  'report'
> &
  Readonly<{ report?: (error: unknown) => void }>

/** Assemble the original canonical plugin and private Peer for native ownership/endpoint tests. */
export function assembleThreadFixture<
  TRemote = Record<never, never>,
  const TProvide extends IRuntimePeerProvide = Record<never, never>,
  const TName extends string = string,
  const TExpose extends readonly string[] = readonly [],
  THost = unknown
>(
  options: Omit<IThreadFixturePluginOptions, 'name' | 'provide' | 'expose'> &
    Readonly<{
      name: TName
      provide?: TProvide
      expose?: TExpose &
        (unknown extends THost ? unknown : readonly IRuntimeExpose<IRuntimeRegistry<THost>>[])
    }>,
  runtime: IThreadRuntimeResource = threadRuntimeResource
): ReturnType<typeof assembleAdapterPlugin> &
  IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'> {
  return assembleAdapterPlugin(
    getThreadMessageAdapter(),
    options as IRuntimePluginOptions<IRuntimeThreadPeerOptions['spawn']>,
    {
      key: RuntimePluginKey.thread,
      acquire: (integration, create) =>
        integration.acquireSharedSlot(RuntimePluginKey.thread, fixtureThreadFamily, create)
    },
    (peerOptions) =>
      createThreadPeer(peerOptions as IRuntimeThreadPeerOptions, runtime) as ReturnType<
        Parameters<typeof assembleAdapterPlugin>[3]
      >
  ) as ReturnType<typeof assembleAdapterPlugin> &
    IRuntimePluginTyping<TRemote, TProvide, TName, TExpose, 'thread'>
}

/** Capture native runtime objects only at the fixture construction boundary. */
const nativeWorkers = vi.hoisted(() => new Map<number, import('node:worker_threads').Worker>())
/** Constructor checkpoint observes whether error registration occurred before asynchronous deferral. */
const nativeErrorListeners = vi.hoisted(() => new Map<number, number>())
/** Source and built launchers record the same genuine Worker only once at native construction. */
function observeNativeWorker(worker: import('node:worker_threads').Worker): void {
  if (nativeWorkers.get(worker.threadId) === worker) return
  nativeWorkers.set(worker.threadId, worker)
  /** This checkpoint queues before an adapter could defer listener attachment. */
  const id = worker.threadId
  queueMicrotask(() => nativeErrorListeners.set(id, worker.listenerCount('error')))
}
vi.mock('node:worker_threads', async (original) => {
  const native = await original<typeof import('node:worker_threads')>()
  return {
    ...native,
    Worker: class extends native.Worker {
      constructor(...args: ConstructorParameters<typeof native.Worker>) {
        super(...args)
        observeNativeWorker(this)
      }
    }
  }
})
/** Built public adapters retain their own cached native module outside Vitest's source mock graph. */
const loadNativeThreadRuntime = threadRuntimeResource.load
vi.spyOn(threadRuntimeResource, 'load').mockImplementation(async () => {
  /** Preserve the actual runtime acquisition and all native facts before observing construction. */
  const native = await loadNativeThreadRuntime()
  /** This exact runtime is Node; the fixture observes its full native Worker methods. */
  const Worker = native.Worker as typeof import('node:worker_threads').Worker
  return {
    ...native,
    Worker: class extends Worker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args)
        observeNativeWorker(this)
      }
    }
  }
})
/** Diagnostic tests read the real Worker without adding a production diagnostic API. */
export function nativeWorkerFor(handle: IThreadHandle): import('node:worker_threads').Worker {
  return nativeWorkers.get(handle.identity.threadId!)!
}

/**
 * Test synchronous error-listener installation structurally rather than relying on Worker startup
 * speed.
 */
export function nativeErrorListenerCount(handle: IThreadHandle): number {
  return nativeErrorListeners.get(handle.identity.threadId!)!
}

/** Real Node fixtures load built ESM independently from Vitest's loader. */
export const workerEntry = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures/rpc-worker.mjs'
)
/** Portable request and stream declarations are shared through workerData. */
export const contract: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'p',
  features: {
    f: {
      methods: {
        read: { mode: 'request', idempotent: true },
        write: { mode: 'request', idempotent: false },
        hold: { mode: 'request', idempotent: true },
        bad: { mode: 'request', idempotent: false },
        stream: { mode: 'generator', idempotent: false },
        notify: { mode: 'one-way', idempotent: false }
      }
    }
  }
}
/** Both sides explicitly consume the channel pipeline, scheduler and stream capability. */
export const endpointFactory: IRemoteEndpointFactory = async (channel) => {
  /** First-party feature graph remains entirely core-owned. */
  const chunk = createCanonicalChunkFeature()
  /** One outbound owner is shared with provider and stream. */
  const outbound = createOutboundFeature(chunk)
  /** The provider exposes stream methods on the same endpoint. */
  const provider = createProviderFeature(outbound)
  const discovery = createDiscoveryFeature(outbound)
  /** Core composes all features before remote publishes the generation. */
  const endpoint = await createComposedEndpoint(
    {
      id: 'client',
      targetIds: [channel.peerId],
      transport: channel.transport,
      scheduler: channel.scheduler,
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport, discoveryMode: 'manual' }),
        ping()
      ]
    },
    {
      'first-party-chunk': chunk,
      'first-party-outbound': outbound,
      'first-party-provider': provider,
      'first-party-one-way': createOneWayFeature(outbound),
      'first-party-discovery': discovery,
      'first-party-control': createControlFeature(outbound, discovery),
      'first-party-stream': createStreamFeature(outbound, provider)
    }
  )
  return {
    endpoint: endpoint as unknown as IRpcEndpoint,
    oneWay: endpoint,
    stream: endpoint.stream
  }
}
/** Portable proxy signatures stay explicit because contract Feature names are runtime data. */
export type IFixtureFeature = {
  read(params: unknown[], options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<unknown>
  write(params: unknown[], options?: { timeoutMs?: number }): Promise<unknown>
  hold(params: unknown[], options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<unknown>
  bad(params: unknown[]): Promise<unknown>
  stream(params: unknown[], options?: { timeoutMs?: number }): AsyncIterableIterator<unknown>
}
/** Fixture endpoint injection remains separate from the production runtime source shape. */
export type IFixtureOptions = IRuntimeThreadSpawn<IThreadHandle> &
  Readonly<{ endpointFactory?: IRemoteEndpointFactory }>

/** Record native generations and outbound frames without adding a retry or lifecycle policy. */
export function nativeFixture(
  overrides: Partial<IFixtureOptions> = {},
  data: Record<string, unknown> = {}
) {
  /** Local Host owns the installed remote definition. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Every real Worker consumes the same one-unit admission budget. */
  const budget = createUnitBudget({
    kind: 'thread',
    maxUnits: 1,
    scheduler: overrides.scheduler ?? systemScheduler
  })
  /** Runtime launcher remains canonical; wrapper records only behavior evidence. */
  const native = createNodeThreadLauncher()
  /** Live and retired handles prove actual exit and immutable identities. */
  const handles: INodeThreadHandle[] = []
  /** Every postMessage argument proves no transfer list ever crosses the facade. */
  const frames: { generation: number; message: any; transfer: unknown }[] = []
  /** Diagnostics keep their original objects for cause and late-rejection assertions. */
  const reported: unknown[] = []
  /** Generation sequence is fixture data rather than a second production state machine. */
  let generation = 0
  /** Wrapper forwards every lifecycle operation and intercepts messaging only. */
  const channels: import('@migaia/rpc-host/plugin').IRemoteChannel[] = []
  /** Factory wrapper records scheduler identity without changing channel ownership. */
  const factory = createNodeThreadChannelFactory({
    scheduler: overrides.scheduler ?? systemScheduler
  })
  const channelFactory = {
    async open(handle: INodeThreadHandle, signal: Parameters<typeof factory.open>[1]) {
      const channel = await factory.open(handle, signal)
      channels.push(channel)
      return channel
    }
  }
  const launcher = {
    capabilities: native.capabilities,
    async launch(
      spec: Parameters<typeof native.launch>[0],
      context: Parameters<typeof native.launch>[1]
    ) {
      const number = ++generation
      const handle = await native.launch(
        { ...spec, data: { contract, ...data, generation: number } },
        context
      )
      const original = handle.port.postMessage
      handle.port.postMessage = (message, transfer) => {
        frames.push({ generation: number, message, transfer })
        Reflect.apply(original, handle.port, [message, transfer])
      }
      handles.push(handle)
      return handle
    }
  }
  /** The same source retains the canonical supervisor, budget, launcher and caller-selected policy. */
  const { endpointFactory: selectedFactory, keyFactory, retryPort, ...sourceOverrides } = overrides
  const spawn = {
    spec: { entry: workerEntry },
    launcher,
    budget,
    scheduler: overrides.scheduler ?? systemScheduler,
    channelFactory,
    report: (error: unknown) => reported.push(error),
    supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 3 } },
    ...sourceOverrides
  }
  /** A true symmetric connection publishes the original shared thread outlet after Host commit. */
  const pluginOptions = {
    name: 'p',
    self: { name: 'parent', instanceId: 'client' },
    spawn,
    endpointFactory: selectedFactory ?? endpointFactory,
    report: (error: unknown) => reported.push(error),
    ...(keyFactory === undefined ? {} : { keyFactory }),
    ...(retryPort === undefined ? {} : { retryPort })
  }
  /** The public factory receives only the actual caller configuration recorded above. */
  const plugin = assembleThreadFixture<IRuntimeDynamicSurface>(pluginOptions)
  return {
    host,
    pluginScheduler: overrides.scheduler ?? systemScheduler,
    launcher,
    budget,
    handles,
    frames,
    channels,
    reported,
    plugin,
    pluginOptions,
    spawn,
    async install(): Promise<IFixtureFeature> {
      await host.use(plugin)
      /** These application payload helpers return the actual outlet Promise or iterator unchanged. */
      const outlet = host.thread!
      return {
        /** Read sends the fixture business value through the new folded method name. */
        read: (params, options) => outlet.request('p', 'p.read', params[0], options),
        /** Non-idempotent writes retain the original managed retry classification. */
        write: (params, options) => outlet.request('p', 'p.write', params[0], options),
        /** A held provider exposes cancellation and total wall-cap behavior at the original owner. */
        hold: (params, options) => outlet.request('p', 'p.hold', params[0], options),
        /** Invalid business results still cross the real provider and serialization boundary. */
        bad: (params) => outlet.request('p', 'p.bad', params[0]),
        /** The helper preserves the canonical consumer iterator, including return and failure. */
        stream: (params, options) => outlet.stream('p', 'p.stream', params[0], options)
      } satisfies IFixtureFeature
    },
    async close() {
      await host.dispose()
    }
  }
}
