import { describe, expect, it } from 'vitest'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { timeout } from '@migaia/rpc-host/features'
import { connectedCoreHosts } from '../host/core-fixture.js'

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

/** Return keeps its local value and releases the remote generator once. */
describe('streaming cancellation', () => {
  it('sends one cancel and receives the producer cleanup acknowledgement', async () => {
    /** The complete call-only feature owns this clock; the Host retains its real clock. */
    const clientClock = controlledDeadlineScheduler()
    /** Count only the original generator's finally operations. */
    let cleaned = 0
    /** Release the original pending provider after observing local cancellation. */
    let resume!: () => void
    /** Provider suspension is application work, separate from production cancellation. */
    const blocked = new Promise<void>((resolve) => {
      resume = resolve
    })
    /** Release the original deadline provider before final Host cleanup. */
    let resumeDeadline!: () => void
    /** A separate application Promise prevents the second generator from finishing early. */
    const deadlineBlocked = new Promise<void>((resolve) => {
      resumeDeadline = resolve
    })
    /** Providers are compiled before the one real native Session handshake. */
    const { a: server, b: client } = await connectedCoreHosts(
      {
        count: function* () {
          try {
            yield 'a'
            yield 'b'
          } finally {
            cleaned += 1
          }
        },
        wait: async function* () {
          yield 'a'
          await blocked
          yield 'b'
        },
        deadline: async function* () {
          yield 'a'
          await deadlineBlocked
          yield 'b'
        }
      },
      {},
      () => undefined
    )
    try {
      const iterator = client.memory.stream('count', null) as AsyncIterableIterator<unknown>
      expect(await iterator.next()).toEqual({ done: false, value: 'a' })
      expect(await iterator.return?.('local')).toEqual({ done: true, value: undefined })
      expect(cleaned).toBe(1)
      expect(await iterator.next()).toEqual({ done: true, value: undefined })
      const thrown = client.memory.stream('count', null) as AsyncIterableIterator<unknown>
      expect(await thrown.next()).toEqual({ done: false, value: 'a' })
      const reason = new Error('caller stopped')
      await expect(thrown.throw?.(reason)).rejects.toBe(reason)
      expect(cleaned).toBe(2)
      const controller = new AbortController()
      const waiting = client.memory.stream('wait', null, {
        signal: controller.signal
      }) as AsyncIterableIterator<unknown>
      expect(await waiting.next()).toEqual({ done: false, value: 'a' })
      const pending = waiting.next()
      const abortReason = new Error('cancelled by caller')
      controller.abort(abortReason)
      await expect(pending).rejects.toBe(abortReason)
      await expect(waiting.next()).rejects.toBe(abortReason)
      resume()
      const timed = client.memory.stream('deadline', null, {
        timeout: timeout({ ms: 50, scheduler: clientClock })
      }) as AsyncIterableIterator<unknown>
      expect(await timed.next()).toEqual({ done: false, value: 'a' })
      const pendingDeadline = timed.next()
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
      resume()
      resumeDeadline()
      await client.close()
      await server.close()
    }
  })
})
