import { resolve } from 'node:path'
import { vi } from 'vitest'
import type { IThreadHandle } from '@migaia/supervision/threads'
import { fileURLToPath } from 'node:url'
import { PluginHost } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createCanonicalChunkFeature } from '../../src/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../src/core/features/outbound.js'
import { createProviderFeature } from '../../src/core/features/provider.js'
import { createStreamFeature } from '../../src/core/features/stream.js'
import { createControlFeature } from '../../src/core/features/control.js'
import { createDiscoveryFeature } from '../../src/core/features/discovery.js'
import { abort } from '../../src/core/middleware/abort.js'
import { codec } from '../../src/core/middleware/codec.js'
import { framer } from '../../src/core/middleware/framer.js'
import { connect } from '../../src/core/middleware/connect.js'
import { ping } from '../../src/core/middleware/ping.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import type { IRemoteContract } from '../../src/remote/contract.js'
import type { IRemoteEndpointFactory } from '../../src/remote/types.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '../../src/threads/adapters/node.js'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import type { IThreadPluginOptions } from '../../src/threads/types.js'

/** Capture native runtime objects only at the fixture construction boundary. */
const nativeWorkers = vi.hoisted(() => new Map<number, import('node:worker_threads').Worker>())
/** Echo observation attaches before the Worker can emit its only message. */
const nativeMessages = vi.hoisted(() => new Map<number, Promise<unknown>>())
vi.mock('node:worker_threads', async (original) => {
  const native = await original<typeof import('node:worker_threads')>()
  return {
    ...native,
    Worker: class extends native.Worker {
      constructor(...args: ConstructorParameters<typeof native.Worker>) {
        super(...args)
        nativeWorkers.set(this.threadId, this)
        if (args[1]?.workerData?.data?.mode === 'echo')
          nativeMessages.set(
            this.threadId,
            new Promise((resolve) => {
              this.once('message', resolve)
            })
          )
      }
    }
  }
})
/** Diagnostic tests read the real Worker without adding a production diagnostic API. */
export function nativeWorkerFor(handle: IThreadHandle): import('node:worker_threads').Worker {
  return nativeWorkers.get(handle.identity.threadId!)!
}

/** Return fixture-only echo observation without exposing native diagnostics in production. */
export function nativeWorkerMessage(handle: IThreadHandle): Promise<unknown> {
  return nativeMessages.get(handle.identity.threadId!)!
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
      'first-party-discovery': discovery,
      'first-party-control': createControlFeature(outbound, discovery),
      'first-party-stream': createStreamFeature(outbound, provider)
    }
  )
  return { endpoint: endpoint as unknown as IRpcEndpoint, stream: endpoint.stream }
}
/** Portable proxy signatures stay explicit because contract Feature names are runtime data. */
export type IFixtureFeature = {
  read(params: unknown[], options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<unknown>
  write(params: unknown[], options?: { timeoutMs?: number }): Promise<unknown>
  hold(params: unknown[], options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<unknown>
  bad(params: unknown[]): Promise<unknown>
  stream(params: unknown[], options?: { timeoutMs?: number }): AsyncIterableIterator<unknown>
}
/** Record native generations and outbound frames without adding a retry or lifecycle policy. */
export function nativeFixture(
  overrides: Partial<IThreadPluginOptions<INodeThreadHandle>> = {},
  data: Record<string, unknown> = {}
) {
  /** Local Host owns the installed remote definition. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
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
  const channels: import('../../src/remote/types.js').IRemoteChannel[] = []
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
  /** No retryPort property is present unless the caller explicitly replaces it. */
  const plugin = createThreadPlugin({
    name: 'p',
    contract,
    host: host.plugin,
    spec: { entry: workerEntry },
    launcher,
    budget,
    scheduler: overrides.scheduler ?? systemScheduler,
    channelFactory,
    endpointFactory,
    report: (error) => reported.push(error),
    supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 3 } },
    ...overrides
  })
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
    async install() {
      const [handle] = await host.use(plugin)
      return handle.getFeature('f') as unknown as IFixtureFeature
    },
    async close() {
      await host.dispose()
    }
  }
}
