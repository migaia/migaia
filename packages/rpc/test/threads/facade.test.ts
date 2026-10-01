import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createThreadHost } from '../../src/threads/host.js'
import { createNodeThreadChannelFactory } from '../../src/threads/adapters/node.js'
import { createServeThreadHost } from '../../src/threads/serve.js'
import { contract, endpointFactory, nativeFixture, workerEntry } from './fixture.js'

/** Each facade owns its own actual Worker and borrows neither another connection nor its Host. */
function hostFixture() {
  const fixture = nativeFixture({}, { hostMode: true })
  const remote = createThreadHost({
    catalog: { p: contract },
    spec: { entry: workerEntry },
    launcher: fixture.launcher,
    budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
    scheduler: systemScheduler,
    channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
    endpointFactory,
    report: (error) => fixture.reported.push(error)
  })
  return { remote, fixture }
}

describe('thread Host facade', () => {
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
