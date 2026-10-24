import { MessageChannel } from 'node:worker_threads'
import { RpcCapability, type IRpcPortableValue } from '@migaia/rpc-contract'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { RemoteMethodName } from '@migaia/rpc-host/plugin'
import { EventEmitter } from 'node:events'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createNodeThreadChannel, createWebThreadChannel } from '../../src/threads/channel.js'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { createRpcHost } from '@migaia/rpc-host'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/public-host.js'
import {
  createAdapterWebThreadLauncher as createWebThreadLauncher,
  createAdapterWebThreadChannelFactory as createWebThreadChannelFactory
} from '../../dist/threads/web-launcher.js'
import { receiveThreadData } from '../../src/threads/bootstrap.js'
import type { IThreadWebPort } from '../../src/threads/types.js'
import { nativeFixture } from './fixture.js'

/** EventTarget peer keeps private bootstrap separate from transport subscriptions. */
function webPair() {
  const left = new EventTarget()
  const right = new EventTarget()
  const messages: unknown[][] = []
  const port = (own: EventTarget, other: EventTarget): IThreadWebPort => ({
    postMessage(message, transfer) {
      messages.push([message, transfer])
      queueMicrotask(() => other.dispatchEvent(new MessageEvent('message', { data: message })))
    },
    addEventListener: (type, listener) => own.addEventListener(type, listener),
    removeEventListener: (type, listener) => own.removeEventListener(type, listener)
  })
  return { left: port(left, right), right: port(right, left), messages }
}

describe('thread channel ownership and portable boundary', () => {
  it('borrows Node message listeners with identity pipeline and zero hello', async () => {
    const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
    const channel = createNodeThreadChannel(port, 'peer', { scheduler: systemScheduler })
    const unsubscribe = channel.transport.subscribe(() => undefined)
    expect(channel.scheduler).toBe(systemScheduler)
    expect(channel.agreement).toMatchObject({ source: 'static', codec: channel.pipeline.codec.id })
    expect(channel.features).toEqual([])
    expect(port.postMessage).not.toHaveBeenCalled()
    expect(port.listenerCount('message')).toBe(1)
    unsubscribe()
    const closing = channel.close()
    expect(channel.close()).toBe(closing)
    await closing
    expect(port.listenerCount('message')).toBe(0)
  })
  it('keeps an explicitly narrowed Web stream profile synchronous and free of control messages', async () => {
    /** This caller-owned EventTarget pair records every physical message, including startup. */
    const pair = webPair()
    /** A fixed-profile subset must preserve the synchronous borrowed-channel API. */
    const channel = createWebThreadChannel(pair.left, 'peer', {
      scheduler: systemScheduler,
      capabilities: [RpcCapability.stream]
    })
    expect(channel).not.toBeInstanceOf(Promise)
    expect(channel.agreement).toMatchObject({
      source: 'static',
      capabilities: [RpcCapability.stream]
    })
    expect(pair.messages).toEqual([])
    await channel.close()
  })
  it('admits Web extensions only after both actual ports acknowledge their own capability offers', async () => {
    /** Both independent proposals travel over the same existing public EventTarget fixture. */
    const pair = webPair()
    /** The local caller proposes transfer, while its peer deliberately omits it. */
    const localOffer = [
      RpcCapability.stream,
      RpcCapability.batch,
      RpcCapability.runtimeApi,
      RpcCapability.portableBinary,
      RpcCapability.nativeBinary,
      RpcCapability.transfer
    ]
    /** The agreed intersection must preserve every shared extension and exclude transfer. */
    const peerOffer = localOffer.filter((capability) => capability !== RpcCapability.transfer)
    /** Publication waits for actual bilateral ACK rather than accepting local declarations. */
    const channels = await Promise.all([
      createWebThreadChannel(pair.left, 'right', {
        scheduler: systemScheduler,
        capabilities: localOffer
      }),
      createWebThreadChannel(pair.right, 'left', {
        scheduler: systemScheduler,
        capabilities: peerOffer
      })
    ])
    try {
      for (const channel of channels) {
        expect(channel.agreement.capabilities).toEqual(peerOffer)
        expect(channel.agreement.capabilities).not.toContain(RpcCapability.transfer)
        expect(channel.scheduler).toBe(systemScheduler)
      }
    } finally {
      await Promise.all(channels.map((channel) => channel.close()))
    }
  })
  it('ignores ordinary messages and acknowledges bootstrap only after service preparation resolves', async () => {
    /** Messages preceding bootstrap must not acquire the private startup listener. */
    const pair = webPair()
    /** The explicit preparation barrier makes ACK ordering observable without timer assumptions. */
    let releasePreparation!: () => void
    /** Completion remains owned by the service preparation callback. */
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    /** This barrier signals actual callback entry after the private message has been recognized. */
    let markStarted!: () => void
    /** Only the valid bootstrap may start preparing the service. */
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    /** The callback exposes the admitted business data and exact peer address. */
    const prepare = vi.fn(async (data: IRpcPortableValue | undefined, peerId: string) => {
      expect(data).toEqual({ value: 9 })
      expect(peerId).toBe('parent')
      markStarted()
      await preparation
    })
    /** The public bootstrap reader owns the one listener until the valid initial message arrives. */
    const receiving = receiveThreadData(pair.right, prepare)
    for (const data of [null, 7, {}, { kind: 'business' }]) pair.left.postMessage(data)
    pair.left.postMessage({
      kind: rpcMessageCapabilityControl.data,
      peerId: 'parent',
      data: { value: 9 }
    })
    await started
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(pair.messages).toHaveLength(5)
    releasePreparation()
    await expect(receiving).resolves.toEqual({ value: 9 })
    expect(pair.messages.at(-1)).toEqual([{ kind: rpcMessageCapabilityControl.ready }, undefined])
  })
  it.each(['prepare', 'address'] as const)(
    'removes the bootstrap listener without acknowledging a rejected %s',
    async (failureKind) => {
      /** Each failed startup owns a fresh pair and exactly one private bootstrap listener. */
      const pair = webPair()
      /** Caller failure must remain the exact original rejection across the reader boundary. */
      const failure = new Error('service preparation failed')
      /** An invalid address is rejected before this service callback can run. */
      const prepare = vi.fn(() => Promise.reject(failure))
      /** Attach the assertion before delivering the physical input, avoiding a late observer. */
      const receiving = receiveThreadData(pair.right, prepare)
      /** Both inputs use the public startup grammar; only the address case is malformed. */
      const initial = {
        kind: rpcMessageCapabilityControl.data,
        peerId: failureKind === 'address' ? 7 : 'parent',
        data: { value: 1 }
      }
      /** Preparation errors preserve identity; invalid wire input retains the existing coded type. */
      const rejected =
        failureKind === 'prepare'
          ? expect(receiving).rejects.toBe(failure)
          : expect(receiving).rejects.toMatchObject({
              source: 'rpc.endpoint',
              code: 'INVALID_CONFIG',
              name: 'TypeError'
            })
      pair.left.postMessage(initial)
      await rejected
      expect(pair.messages).toEqual([[initial, undefined]])
      pair.left.postMessage({ kind: rpcMessageCapabilityControl.data, peerId: 'parent' })
      await Promise.resolve()
      expect(prepare).toHaveBeenCalledTimes(failureKind === 'prepare' ? 1 : 0)
      expect(pair.messages).toHaveLength(2)
    }
  )
  it('rejects functions, cycles, MessagePort and SharedArrayBuffer before a public request frame', async () => {
    const fixture = nativeFixture()
    const ports = new MessageChannel()
    const cycle: unknown[] = []
    cycle.push(cycle)
    try {
      const feature = await fixture.install()
      expect(await feature.read([{ value: 1 }])).toEqual({ value: 1 })
      const before = fixture.frames.length
      for (const value of [() => undefined, cycle, ports.port1, new SharedArrayBuffer(8)])
        expect(() => feature.read([value])).toThrow(
          expect.objectContaining({
            code: 'INVALID_ENVELOPE',
            source: 'rpc.contract'
          })
        )
      expect(fixture.frames).toHaveLength(before)
      /** A controlled Contract failure crosses the boundary as code/text without local causes. */
      const remoteError = await feature.bad([]).catch((error: unknown) => error)
      expect(remoteError).toMatchObject({
        source: 'rpc.endpoint',
        code: 'PAYLOAD_INVALID',
        message: 'Runtime request result must be portable',
        stack: expect.any(String)
      })
      expect((remoteError as Error).cause).toMatchObject({
        source: 'rpc.contract',
        code: 'INVALID_ENVELOPE'
      })
      expect(fixture.frames.every(({ transfer }) => transfer === undefined)).toBe(true)
    } finally {
      ports.port1.close()
      ports.port2.close()
      await fixture.close()
    }
  })
  it.each([() => undefined, new SharedArrayBuffer(8)])(
    'rejects facade spec.data synchronously without a Worker',
    async (data) => {
      const launch = vi.fn()
      const common = {
        spec: { entry: 'file:///worker.mjs', data },
        launcher: {
          capabilities: {
            termination: 'enforced' as const,
            'exit-observation': 'enforced' as const
          },
          launch
        },
        budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
        scheduler: systemScheduler,
        channelFactory: { open: vi.fn() },

        report: vi.fn()
      }
      const host = runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      try {
        for (const build of [
          () =>
            host.use(
              threadPlugin({
                name: 'p',
                spawn: common,

                report: vi.fn()
              })
            ),
          () => createRpcHost({ plugins: [threadPlugin({ spawn: common })], report: vi.fn() })
        ]) {
          const failure = await build().catch((error: unknown) => error)
          const native =
            (failure as { code?: string }).code === 'PLUGIN_INSTALL_FAILED'
              ? (failure as { cause: unknown }).cause
              : failure
          expect(native).toBeInstanceOf(TypeError)
          expect(native).toMatchObject({
            code: 'INVALID_CONFIG',
            detail: { field: 'spec.data' },
            cause: { source: 'rpc.contract' }
          })
        }
        expect(launch).not.toHaveBeenCalled()
      } finally {
        await host.dispose()
      }
    }
  )
  it('consumes and removes Web bootstrap before acknowledging and installing client transport', async () => {
    const pair = webPair()
    const launched: IThreadWebPort[] = []
    const Worker = class {
      constructor() {
        launched.push(pair.left)
      }
      postMessage = pair.left.postMessage
      addEventListener = pair.left.addEventListener
      removeEventListener = pair.left.removeEventListener
      terminate = vi.fn()
    }
    let service: Awaited<ReturnType<typeof createWebThreadChannel>> | undefined
    const receive = receiveThreadData(pair.right, (data) => {
      expect(data).toEqual({ value: 7 })
      service = createWebThreadChannel(pair.right, 'parent', { scheduler: systemScheduler })
    })
    const launcher = createWebThreadLauncher({ Worker, report: vi.fn() })
    const handle = await launcher.launch(
      { entry: 'file:///worker.mjs', data: { value: 7 } },
      { signal: new AbortController().signal }
    )
    const channel = await createWebThreadChannelFactory({ scheduler: systemScheduler }).open(
      handle,
      new AbortController().signal
    )
    expect(await receive).toEqual({ value: 7 })
    expect(pair.messages).toHaveLength(2)
    expect(pair.messages.every((args) => args[1] === undefined)).toBe(true)
    const rpc = vi.fn()
    const remove = channel.transport.subscribe(rpc)
    service!.transport.send({ method: RemoteMethodName.runtimeDescribe })
    await Promise.resolve()
    expect(rpc).toHaveBeenCalledExactlyOnceWith({
      data: { method: RemoteMethodName.runtimeDescribe }
    })
    remove()
    await channel.close()
    await service!.close()
    handle.terminate()
    expect(launched).toHaveLength(1)
  })
})
