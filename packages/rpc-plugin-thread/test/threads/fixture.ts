import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { type INodeThreadHandle } from '../../dist/threads/node-launcher.js'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import type { IThreadHandle } from '@migaia/supervision/threads'
import { fileURLToPath } from 'node:url'
import { defineHost } from '@migaia/plugin-host'
import type { IRpcCallOptions } from '@migaia/rpc-host'
import { rpcHostPipelines, type IRpcNativeMemberControls } from '@migaia/rpc-host/sdk'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'

import type { IRpcProviderDeclaration } from '@migaia/rpc-contract/protocol'

import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/node-launcher.js'

import type { IThreadSpawn } from '../../src/threads/source.js'

/** The genuine native Host contributes one actual thread namespace after installation. */
export type INativeFixtureHost = ReturnType<typeof defineHost> &
  Readonly<{
    thread: Readonly<{
      members: IRpcNativeMemberControls<'thread'>
      send(
        name: string,
        method: string,
        payload?: unknown,
        options?: IRpcCallOptions
      ): Promise<unknown>
      notify(method: string, payload?: unknown, options?: IRpcCallOptions): Promise<void>
      stream(
        method: string,
        payload?: unknown,
        options?: IRpcCallOptions
      ): AsyncGenerator<unknown, unknown, unknown>
    }>
  }>

import { threadRuntimeResource } from '../../dist/threads/runtime-resource.js'
import { threadRuntimeResource as sourceThreadRuntimeResource } from '../../src/threads/runtime-resource.js'

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
/** Source and built adapters each own a cached native module; observe both actual acquisition ports. */
for (const resource of new Set([threadRuntimeResource, sourceThreadRuntimeResource])) {
  /** Preserve each module owner's original native loader before observing its constructor. */
  const loadNativeThreadRuntime = resource.load
  vi.spyOn(resource, 'load').mockImplementation(async () => {
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
}
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
export const contract: IRpcProviderDeclaration = {
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
/** Portable proxy signatures stay explicit because contract Feature names are runtime data. */
export type IFixtureFeature = {
  read(params: unknown[], options?: IRpcCallOptions): Promise<unknown>
  write(params: unknown[], options?: IRpcCallOptions): Promise<unknown>
  hold(params: unknown[], options?: IRpcCallOptions): Promise<unknown>
  bad(params: unknown[]): Promise<unknown>
  stream(params: unknown[], options?: IRpcCallOptions): AsyncIterableIterator<unknown>
}
/** Native fixture overrides use the exact supported production spawn recipe. */
export type IFixtureOptions = IThreadSpawn<IThreadHandle>

/** Record native generations and outbound frames without adding a retry or lifecycle policy. */
/** Allocate only this case's original observations before installing native-shaped callbacks. */
function nativeThreadFixtureState(
  overrides: Partial<IFixtureOptions> = {},
  data: Record<string, unknown> = {}
) {
  /** Lazy pipeline authority reads this case's own native host only at installation. */
  const rpc = rpcHostPipelines(
    () => host,
    (name, request) => host.pipeline(name, request)
  )
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  }) as INativeFixtureHost
  const budget = createUnitBudget({
    kind: 'thread',
    maxUnits: 1,
    scheduler: overrides.scheduler ?? systemScheduler
  })
  const native = createNodeThreadLauncher()
  const handles: INodeThreadHandle[] = []
  const frames: { generation: number; message: any; transfer: unknown }[] = []
  const reported: unknown[] = []
  let generation = 0
  const channels: IRpcCarrier[] = []
  const factory = createNodeThreadChannelFactory({
    scheduler: overrides.scheduler ?? systemScheduler
  })
  return {
    overrides,
    data,
    host,
    budget,
    native,
    handles,
    frames,
    reported,
    generation,
    channels,
    factory
  }
}

/** Own one test resource's mutable observations without sharing a factory closure. */
class NativeThreadFixture {
  /** Counts, native events and construction inputs belong only to this fixture instance. */
  #state: ReturnType<typeof nativeThreadFixtureState>
  /** Existing consumers retain the same observable fixture surface and callback identities. */
  readonly value
  /** Install the original native-shaped callbacks after their observations exist. */
  constructor(overrides: Partial<IFixtureOptions> = {}, data: Record<string, unknown> = {}) {
    this.#state = nativeThreadFixtureState(overrides, data)
    const channelFactory = {
      open: async (
        handle: INodeThreadHandle,
        signal: Parameters<ReturnType<typeof createNodeThreadChannelFactory>['open']>[1]
      ) => {
        const channel = await this.#state.factory.open(handle, signal)
        this.#state.channels.push(channel)
        return channel
      }
    }
    const launcher = {
      capabilities: this.#state.native.capabilities,
      launch: async (
        spec: Parameters<ReturnType<typeof createNodeThreadLauncher>['launch']>[0],
        context: Parameters<ReturnType<typeof createNodeThreadLauncher>['launch']>[1]
      ) => {
        const number = ++this.#state.generation
        const handle = await this.#state.native.launch(
          { ...spec, data: { contract, ...this.#state.data, generation: number } },
          context
        )
        /** The held resource captured its port before launch returned; observe its actual Worker. */
        const worker = nativeWorkerFor(handle)
        /** The observer forwards to this exact native method with its original Worker receiver. */
        const original = worker.postMessage
        worker.postMessage = (message, transfer) => {
          this.#state.frames.push({ generation: number, message, transfer })
          Reflect.apply(original, worker, [message, transfer])
        }
        this.#state.handles.push(handle)
        return handle
      }
    }
    const sourceOverrides = this.#state.overrides
    const spawn = {
      spec: { entry: workerEntry },
      launcher,
      budget: this.#state.budget,
      scheduler: this.#state.overrides.scheduler ?? systemScheduler,
      channelFactory,
      report: (error: unknown) => this.#state.reported.push(error),
      supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 3 } },
      ...sourceOverrides
    }
    const pluginOptions = {
      name: 'p',
      spawn,
      report: (error: unknown) => this.#state.reported.push(error)
    }
    const plugin = threadPlugin(pluginOptions)
    this.value = {
      host: this.#state.host,
      pluginScheduler: this.#state.overrides.scheduler ?? systemScheduler,
      launcher,
      budget: this.#state.budget,
      handles: this.#state.handles,
      frames: this.#state.frames,
      channels: this.#state.channels,
      reported: this.#state.reported,
      plugin,
      pluginOptions,
      spawn,
      install: async (): Promise<IFixtureFeature> => {
        await this.#state.host.use(plugin)
        /** These application payload helpers return the actual outlet Promise or iterator unchanged. */
        const outlet = this.#state.host.thread!
        return {
          /** Read sends the fixture business value through the new folded method name. */
          read: (params, options) => outlet.send('p', 'p.read', params[0], options),
          /** Non-idempotent writes retain the original managed retry classification. */
          write: (params, options) => outlet.send('p', 'p.write', params[0], options),
          /** A held provider exposes cancellation and total wall-cap behavior at the original owner. */
          hold: (params, options) => outlet.send('p', 'p.hold', params[0], options),
          /** Invalid business results still cross the real provider and serialization boundary. */
          bad: (params) => outlet.send('p', 'p.bad', params[0]),
          /** The helper preserves the canonical consumer iterator, including return and failure. */
          stream: (params, options) => outlet.stream('p.stream', params[0], options)
        } satisfies IFixtureFeature
      },
      close: async () => {
        await this.#state.host.dispose()
      }
    }
  }
}

/** Create one independent owner for the existing native-boundary fixture. */
export function nativeFixture(
  overrides: Partial<IFixtureOptions> = {},
  data: Record<string, unknown> = {}
) {
  return new NativeThreadFixture(overrides, data).value
}
