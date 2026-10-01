import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { createRemoteRetryPort } from '../../src/remote/retry.js'
import type { IRemoteGenerationEvents } from '../../src/remote/types.js'

describe('shared retry deadline', () => {
  it('[A9] expires the original deadline while waiting for the next generation', async () => {
    const scheduler = createManualScheduler()
    let leave: (reason: unknown) => void = () => undefined
    let canceled = false
    const events: IRemoteGenerationEvents = {
      current: () => ({ generation: 1, active: true }),
      onLeave: (_generation, listener) => {
        leave = listener
        return () => undefined
      },
      whenReady: (_after, signal) =>
        new Promise<number>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            canceled = true
            reject(signal.reason)
          })
        })
    }
    const sendOnce = vi.fn(() => new Promise<string>(() => undefined))
    const result = createRemoteRetryPort({ events, scheduler, report: vi.fn() }).dispatch({
      method: 'p.f.read',
      mode: 'request',
      idempotent: true,
      generation: 1,
      deadlineAt: 50,
      events,
      sendOnce
    })
    leave(new Error('left'))
    scheduler.advance(50)
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(canceled).toBe(true)
    expect(sendOnce).toHaveBeenCalledTimes(1)
    expect(scheduler.pendingCount).toBe(0)
  })
})
