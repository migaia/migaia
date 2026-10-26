import { MessageChannel } from 'node:worker_threads'
import { EventEmitter } from 'node:events'
import { defineHost } from '@migaia/plugin-host'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createNodeThreadCarrier } from '../../dist/threads/channel.js'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { createRpcHost } from '@migaia/rpc-host'
import { nativeFixture } from './fixture.js'

describe('thread channel ownership and portable boundary', () => {
  it('borrows Node message listeners and sends zero hello before the Host attaches', async () => {
    const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() })
    const channel = createNodeThreadCarrier(port, 'peer', (error) => {
      throw error
    })
    expect(channel.closingWrites).toBe(true)
    expect(channel.mapRetirement).toBeUndefined()
    const unsubscribe = channel.subscribe({
      frame: () => undefined,
      close: () => undefined,
      error: (error) => {
        throw error
      }
    })
    expect(port.postMessage).not.toHaveBeenCalled()
    expect(port.listenerCount('message')).toBe(1)
    unsubscribe()
    const closing = channel.close()
    expect(channel.close()).toBe(closing)
    await closing
    expect(port.listenerCount('message')).toBe(0)
  })
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
        await expect(feature.read([value])).rejects.toMatchObject({
          code: 'INVALID_ENVELOPE',
          source: 'rpc.contract'
        })
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
    'rejects native spec.data before acquiring a Worker on either public Host entry',
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
      /** Lazy pipeline authority reads this case's own native host only at installation. */
      const rpc = rpcHostPipelines(
        () => host,
        (name) => host.pipeline(name),
        ['thread']
      )
      const host = defineHost({
        ...rpc,
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
})
