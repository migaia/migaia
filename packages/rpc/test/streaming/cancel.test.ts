import { describe, expect, it } from 'vitest'
import { createManualScheduler, systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { connect } from '../../src/core/middleware/connect.js'
import { streamRoots } from './fixture.js'

/** Keep deadlines virtual while preserving the endpoint's ordinary zero-delay data handoff. */
function controlledDeadlineScheduler(): IScheduler & { advance(ms: number): void } {
  const manual = createManualScheduler()
  return {
    now: () => manual.now(),
    schedule: (task, delayMs) =>
      delayMs === 0 ? systemScheduler.schedule(task, 0) : manual.schedule(task, delayMs),
    advance: (ms) => manual.advance(ms)
  }
}

/** A4 return keeps its local value and releases the remote generator once. */
describe('streaming A4 cancellation', () => {
  it('sends one cancel and receives the producer cleanup acknowledgement', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    /** Independent virtual deadline clocks let the provider expire before the caller. */
    const serverClock = controlledDeadlineScheduler()
    /** Caller deadline is advanced explicitly only after its first value arrives. */
    const clientClock = controlledDeadlineScheduler()
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        scheduler: serverClock,
        middlewares: [connect({ transport: serverTransport })]
      },
      streamRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        scheduler: clientClock,
        middlewares: [connect({ transport: clientTransport })]
      },
      streamRoots()
    )
    let cleaned = 0
    server.stream.provide('count', function* () {
      try {
        yield 'a'
        yield 'b'
      } finally {
        cleaned += 1
      }
    })
    let resume!: () => void
    const blocked = new Promise<void>((resolve) => {
      resume = resolve
    })
    server.stream.provide('wait', async function* () {
      yield 'a'
      await blocked
      yield 'b'
    })
    let resumeDeadline!: () => void
    const deadlineBlocked = new Promise<void>((resolve) => {
      resumeDeadline = resolve
    })
    server.stream.provide('deadline', async function* () {
      yield 'a'
      await deadlineBlocked
      yield 'b'
    })
    try {
      const iterator = client.stream.open('server', 'count', null)
      expect(await iterator.next()).toEqual({ done: false, value: 'a' })
      expect(await iterator.return?.('local')).toEqual({ done: true, value: 'local' })
      expect(cleaned).toBe(1)
      expect(await iterator.next()).toEqual({ done: true, value: undefined })
      const thrown = client.stream.open('server', 'count', null)
      expect(await thrown.next()).toEqual({ done: false, value: 'a' })
      const reason = new Error('caller stopped')
      await expect(thrown.throw?.(reason)).rejects.toBe(reason)
      expect(cleaned).toBe(2)
      const controller = new AbortController()
      const waiting = client.stream.open('server', 'wait', null, { signal: controller.signal })
      expect(await waiting.next()).toEqual({ done: false, value: 'a' })
      const pending = waiting.next()
      const abortReason = new Error('cancelled by caller')
      controller.abort(abortReason)
      await expect(pending).rejects.toBe(abortReason)
      await expect(waiting.next()).rejects.toBe(abortReason)
      resume()
      const timed = client.stream.open('server', 'deadline', null, { timeoutMs: 50 })
      expect(await timed.next()).toEqual({ done: false, value: 'a' })
      const pendingDeadline = timed.next()
      serverClock.advance(50)
      clientClock.advance(50)
      let deadlineError: unknown
      try {
        await pendingDeadline
      } catch (error) {
        deadlineError = error
      }
      expect(deadlineError).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      await expect(timed.next()).rejects.toBe(deadlineError)
      resumeDeadline()
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
