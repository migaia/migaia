import { describe, expect, it } from 'vitest'
import type { IAbortSignal } from '@migaia/lifecycle'
import { createProcessHost } from '../../src/process/host/client.js'
import { hostFixture } from './fixtures/host-control.js'

/** Flush candidate cancellation and queued mutation continuations without changing time budgets. */
async function settle(): Promise<void> {
  for (let index = 0; index < 48; index += 1) await Promise.resolve()
}

describe('process Host replacement publication', () => {
  it('[A3] stops the old owned unit before launching and retains the same facade', async () => {
    const fixture = hostFixture()
    const host = createProcessHost(fixture.options)
    await host.ready()
    const oldId = host.inspectRegistration()?.id
    if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
    const spec = { ...fixture.options.deployment.supervision.spec, args: ['replacement'] }
    try {
      expect(await host.replace({ spec })).toBe(host)
      expect(fixture.order).toEqual(['launch:1', 'exit:1', 'launch:2'])
      expect(fixture.launch.mock.calls).toHaveLength(2)
      expect(host.inspectRegistration()?.id).not.toBe(oldId)
      await host.use('p')
    } finally {
      await host.release()
    }
  })

  it('[A4] holds old service until description, publishes once and queues every spec', async () => {
    const fixture = hostFixture()
    let complete!: () => void
    const described = new Promise<void>((resolve) => {
      complete = resolve
    })
    const send = fixture.send.getMockImplementation()!
    fixture.send.mockImplementation(async (peer, method) => {
      if (method === 'migaia.remote.describe' && fixture.launch.mock.calls.length === 2)
        await described
      return send(peer, method)
    })
    const host = createProcessHost({ ...fixture.options, replaceStrategy: 'start-then-switch' })
    await host.ready()
    if (fixture.options.deployment.kind !== 'spawn') throw new Error('fixture deployment')
    const specA = { ...fixture.options.deployment.supervision.spec, args: ['A'] }
    const specB = { ...fixture.options.deployment.supervision.spec, args: ['B'] }
    const first = host.replace({ spec: specA })
    const second = host.replace({ spec: specB })
    expect(second).not.toBe(first)
    await settle()
    expect(fixture.launch.mock.calls).toHaveLength(2)
    expect(fixture.terminate).not.toHaveBeenCalled()
    await host.use('p')
    complete()
    try {
      expect(await first).toBe(host)
      expect(await second).toBe(host)
      expect(fixture.launch.mock.calls).toHaveLength(3)
      expect(fixture.order).toEqual(['launch:1', 'launch:2', 'exit:1', 'launch:3', 'exit:2'])
    } finally {
      await host.release()
    }
  })

  it('[A3/A4] cancels a delayed candidate and refuses queued replacement without another launch', async () => {
    const fixture = hostFixture()
    const send = fixture.send.getMockImplementation()!
    /** The actual core endpoint honors cancellation; this neutral held-send fixture must too. */
    let candidateSignal: IAbortSignal | undefined
    const factory = fixture.options.endpointFactory
    const options = {
      ...fixture.options,
      endpointFactory: async (...args: Parameters<typeof factory>) => {
        candidateSignal = args[1]
        return factory(...args)
      }
    }
    /** Release races a real describe boundary rather than an assumed number of microtasks. */
    let entered!: () => void
    const describing = new Promise<void>((resolve) => {
      entered = resolve
    })
    fixture.send.mockImplementation(async (peer, method) => {
      if (method === 'migaia.remote.describe' && fixture.launch.mock.calls.length > 1) {
        entered()
        return new Promise<never>((_resolve, reject) => {
          const signal = candidateSignal!
          const cancel = () => reject(signal.reason)
          signal.addEventListener('abort', cancel, { once: true })
          if (signal.aborted) cancel()
        })
      }
      return send(peer, method)
    })
    const host = createProcessHost(options)
    await host.ready()
    const first = host.replace()
    const second = host.replace()
    const results = Promise.allSettled([first, second])
    await describing
    await host.release()
    const outcomes = await results
    expect(outcomes[0]).toMatchObject({ status: 'rejected' })
    expect(outcomes[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'PROCESS_HOST_CLOSED' }
    })
    expect(fixture.launch.mock.calls).toHaveLength(2)
    expect(host.inspectRegistration()).toBeUndefined()
  })
})
