import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler, createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import type { IThreadHostOptions } from '../../src/threads/types.js'
import type { INodeThreadHandle } from '../../src/threads/adapters/node.js'
import { createThreadHost } from '../../src/threads/host.js'
import { createNodeThreadChannelFactory } from '../../src/threads/adapters/node.js'
import { createServeThreadHost } from '../../src/threads/serve.js'
import {
  contract,
  endpointFactory,
  nativeFixture,
  workerEntry,
  type IFixtureFeature
} from './fixture.js'

/** Each facade owns its own actual Worker and borrows neither another connection nor its Host. */
function hostFixture(overrides: Partial<IThreadHostOptions<INodeThreadHandle>> = {}) {
  const fixture = nativeFixture({}, { hostMode: true })
  const remote = createThreadHost({
    catalog: { p: contract },
    spec: { entry: workerEntry },
    launcher: fixture.launcher,
    budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
    scheduler: systemScheduler,
    channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
    endpointFactory,
    report: (error) => fixture.reported.push(error),
    ...overrides
  })
  return { remote, fixture }
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
      const feature = await host.remote.use('p')
      /** Caller allowance is larger, so the facade's 100 ms cap must win. */
      const result = (feature.f as unknown as IFixtureFeature)
        .hold([], { timeoutMs: 200 })
        .catch((error: unknown) => error)
      await expect
        .poll(() => host.fixture.frames.some(({ message }) => message.method === 'p.f.hold'), {
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
      expect(
        host.fixture.frames.filter(({ message }) => message.method === 'p.f.hold')
      ).toHaveLength(1)
    } finally {
      await host.remote.release()
      await host.fixture.close()
    }
    expect(scheduler.pendingCount).toBe(0)
  })

  it('[A2] uses two independent Worker Hosts and closes only one connection', async () => {
    const first = hostFixture()
    const second = hostFixture()
    try {
      const left = await first.remote.use('p', { value: 1 })
      const right = await second.remote.use('p', { value: 2 })
      expect(await left.f!.read!(['first'])).toBe('first')
      expect(await right.f!.read!(['second'])).toBe('second')
      expect(await first.remote.inspect()).toMatchObject({ plugins: [{ name: 'p' }] })
      const frames = first.fixture.frames.length
      await expect(first.remote.use('unknown')).rejects.toMatchObject({
        code: 'REMOTE_CONTRACT_INVALID'
      })
      expect(first.fixture.frames).toHaveLength(frames)
      await first.remote.release()
      expect(await right.f!.read!(['still live'])).toBe('still live')
      expect(first.fixture.handles[0]!.identity.fingerprint).not.toBe(
        second.fixture.handles[0]!.identity.fingerprint
      )
    } finally {
      await first.remote.release()
      await second.remote.release()
      await first.fixture.close()
      await second.fixture.close()
    }
  })
  it('[A2] rejects absent local resolver before endpoint publication', async () => {
    let endpoints = 0
    await expect(
      createServeThreadHost({
        host: {} as never,
        catalog: { p: contract },
        resolvePlugin: undefined as never,
        channel: {} as never,
        endpointFactory: async () => {
          endpoints += 1
          return {} as never
        },
        report: () => undefined
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG', detail: { field: 'resolvePlugin' } })
    expect(endpoints).toBe(0)
  })
})
