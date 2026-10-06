import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import type { IThreadCommonOptions } from '../../src/threads/types.js'
import type { IThreadHandle } from '@migaia/supervision/threads'
import { createNodeThreadChannelFactory } from '../../src/threads/adapters/node.js'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { RemoteMethodName } from '../../src/remote/constants.js'
import { runtimeTestHost } from '../runtime-api/fixture.js'
import { contract, nativeFixture, workerEntry } from './fixture.js'

/** Each facade owns its own actual Worker and borrows neither another connection nor its Host. */
function hostFixture(overrides: Partial<IThreadCommonOptions<IThreadHandle>> = {}) {
  return nativeFixture(overrides, { hostMode: true })
}

describe('thread Host facade', () => {
  it('[A5] Host forwards callWallTimeMs as the total request deadline', async () => {
    /** The clock is advanced only after a real Worker has received the logical call. */
    const scheduler = createManualScheduler()
    /** Host requests use the same remote deadline owner as Plugin requests. */
    const host = hostFixture({
      scheduler,
      channelFactory: createNodeThreadChannelFactory({ scheduler }),
      spec: { entry: workerEntry, limits: { callWallTimeMs: 100 } }
    })
    try {
      /** Adoption creates the actual Worker-side plugin before its never-finishing request. */
      await host.host.use(host.plugin)
      const outlet = host.host.thread!
      await outlet.request('p', RemoteMethodName.hostUse, ['p'])
      /** Caller allowance is larger, so the facade's 100 ms cap must win. */
      const result = outlet
        .request('p', 'p.hold', undefined, { timeoutMs: 200 })
        .catch((error: unknown) => error)
      await expect
        .poll(() => host.frames.some(({ message }) => message.method === 'p.hold'), {
          timeout: 1000
        })
        .toBe(true)
      scheduler.advance(100)
      /** Allow cancellation settlement without waiting for a wall-clock timeout. */
      let settled = false
      void result.then(() => {
        settled = true
      })
      for (let turn = 0; turn < 40; turn += 1) await Promise.resolve()
      expect(settled).toBe(true)
      expect(await result).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      expect(host.frames.filter(({ message }) => message.method === 'p.hold')).toHaveLength(1)
    } finally {
      await host.close()
    }
    expect(scheduler.pendingCount).toBe(0)
  })

  it('[A2] uses two independent Worker Hosts and closes only one connection', async () => {
    const first = hostFixture()
    const second = hostFixture()
    try {
      await first.host.use(first.plugin)
      await second.host.use(second.plugin)
      const left = first.host.thread!
      const right = second.host.thread!
      await left.request('p', RemoteMethodName.hostUse, ['p', { value: 1 }])
      await right.request('p', RemoteMethodName.hostUse, ['p', { value: 2 }])
      expect(await left.request('p', 'p.read', 'first')).toBe('first')
      expect(await right.request('p', 'p.read', 'second')).toBe('second')
      expect(await left.request('p', RemoteMethodName.hostInspect, [])).toMatchObject({
        plugins: [{ name: 'p' }]
      })
      const frames = first.frames.length
      expect(() => left.request('p', 'unknown.read')).toThrow(
        expect.objectContaining({ code: 'PROVIDER_NOT_FOUND' })
      )
      expect(first.frames).toHaveLength(frames)
      await first.close()
      expect(await right.request('p', 'p.read', 'still live')).toBe('still live')
      expect(first.handles[0]!.identity.fingerprint).not.toBe(
        second.handles[0]!.identity.fingerprint
      )
    } finally {
      await first.close()
      await second.close()
    }
  })
  it('[A2] rejects absent local resolver before endpoint publication', async () => {
    let endpoints = 0
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    let sources = 0
    try {
      await expect(
        host.use(
          createThreadPlugin({
            name: 'connection',
            host,
            expose: ['host'],
            catalog: { p: contract },
            resolvePlugin: undefined as never,
            connect: async () => {
              sources += 1
              return {} as never
            },
            endpointFactory: async () => {
              endpoints += 1
              return {} as never
            },
            report: () => undefined
          })
        )
      ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: { code: 'INVALID_CONFIG' } })
      expect(endpoints).toBe(0)
      expect(sources).toBe(0)
    } finally {
      await host.dispose()
    }
  })
})
