import { MessageChannel } from 'node:worker_threads'
import { EventEmitter } from 'node:events'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createNodeThreadChannel, createWebThreadChannel } from '../../src/threads/channel.js'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { createThreadHost } from '../../src/threads/host.js'
import {
  createBrowserThreadLauncher,
  createBrowserThreadChannelFactory
} from '../../src/threads/adapters/browser.js'
import { receiveThreadData } from '../../src/threads/bootstrap.js'
import type { IThreadWebPort } from '../../src/threads/types.js'
import { nativeFixture, contract, endpointFactory } from './fixture.js'

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
  it('[A1/A9] borrows Node message listeners with identity pipeline and zero hello', async () => {
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
  it('[A9] rejects functions, cycles, MessagePort and SharedArrayBuffer before a public request frame', async () => {
    const fixture = nativeFixture()
    const ports = new MessageChannel()
    const cycle: unknown[] = []
    cycle.push(cycle)
    try {
      const feature = await fixture.install()
      expect(await feature.read([{ value: 1 }])).toEqual({ value: 1 })
      const before = fixture.frames.length
      for (const value of [() => undefined, cycle, ports.port1, new SharedArrayBuffer(8)])
        await expect(feature.read([value])).rejects.toMatchObject({
          code: 'REMOTE_CONTRACT_INVALID',
          cause: { source: '@migaia/rpc/contract' }
        })
      expect(fixture.frames).toHaveLength(before)
      /** A controlled Contract failure crosses the boundary as code/text without local causes. */
      const remoteError = await feature.bad([]).catch((error: unknown) => error)
      expect(remoteError).toMatchObject({
        source: '@migaia/rpc/core',
        code: 'INVALID_ENVELOPE',
        message: 'rpc envelope is invalid',
        stack: expect.any(String)
      })
      expect((remoteError as Error).cause).toBeUndefined()
      expect(fixture.frames.every(({ transfer }) => transfer === undefined)).toBe(true)
    } finally {
      ports.port1.close()
      ports.port2.close()
      await fixture.close()
    }
  })
  it.each([() => undefined, new SharedArrayBuffer(8)])(
    '[A9] rejects facade spec.data synchronously without a Worker',
    (data) => {
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
        endpointFactory,
        report: vi.fn()
      }
      for (const build of [
        () =>
          createThreadPlugin({
            ...common,
            name: 'p',
            contract,
            host: { disable: vi.fn(), enable: vi.fn() }
          }),
        () => createThreadHost({ ...common, catalog: { p: contract } })
      ]) {
        try {
          build()
          expect.unreachable()
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError)
          expect(error).toMatchObject({
            code: 'INVALID_CONFIG',
            detail: { field: 'spec.data' },
            cause: { source: '@migaia/rpc/contract' }
          })
        }
      }
      expect(launch).not.toHaveBeenCalled()
    }
  )
  it('[A9] consumes and removes Web bootstrap before acknowledging and installing client transport', async () => {
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
    let service: ReturnType<typeof createWebThreadChannel> | undefined
    const receive = receiveThreadData(pair.right, (data) => {
      expect(data).toEqual({ value: 7 })
      service = createWebThreadChannel(pair.right, 'parent', { scheduler: systemScheduler })
    })
    const launcher = createBrowserThreadLauncher({ Worker, report: vi.fn() })
    const handle = await launcher.launch(
      { entry: 'file:///worker.mjs', data: { value: 7 } },
      { signal: new AbortController().signal }
    )
    const channel = await createBrowserThreadChannelFactory({ scheduler: systemScheduler }).open(
      handle,
      new AbortController().signal
    )
    expect(await receive).toEqual({ value: 7 })
    expect(pair.messages).toHaveLength(2)
    expect(pair.messages.every((args) => args[1] === undefined)).toBe(true)
    const rpc = vi.fn()
    const remove = channel.transport.subscribe(rpc)
    service!.transport.send({ method: 'migaia.remote.describe' })
    await Promise.resolve()
    expect(rpc).toHaveBeenCalledExactlyOnceWith({ data: { method: 'migaia.remote.describe' } })
    remove()
    await channel.close()
    await service!.close()
    handle.terminate()
    expect(launched).toHaveLength(1)
  })
})
