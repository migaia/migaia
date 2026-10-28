import { createManualScheduler } from '@migaia/utils/testing'
import type { IRpcAvailableAttempt } from '@migaia/rpc-contract/interfaces'
import { retryFeature } from '@migaia/rpc-host/features/retry'
import { describe, expect, it, vi } from 'vitest'

describe('shared retry deadline', () => {
  it('expires the original deadline while waiting for the next generation', async () => {
    const scheduler = createManualScheduler()
    let leave: (reason: unknown) => void = () => undefined
    let canceled = false
    const available: IRpcAvailableAttempt = {
      carrierId: 'original',
      generation: 1,
      onLeave: (listener) => {
        leave = listener
        return () => undefined
      },
      whenReady: (signal) =>
        new Promise<IRpcAvailableAttempt>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            canceled = true
            reject(signal.reason)
          })
        })
    }
    const sendOnce = vi.fn(() => new Promise<string>(() => undefined))
    const result = retryFeature({ scheduler, report: vi.fn() }).run({
      signal: new AbortController().signal,
      facts: {
        method: 'p.f.read',
        idempotent: true,
        availability: { current: () => available }
      },
      remainingMs: 50,
      invoke: (_signal, _budget, options) => {
        /** The original unit send entry is explicit; this is not a native physical-write proof. */
        options?.onWriteStart?.()
        return sendOnce()
      }
    })
    leave(new Error('left'))
    scheduler.advance(50)
    await expect(result).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(canceled).toBe(true)
    expect(sendOnce).toHaveBeenCalledTimes(1)
    expect(scheduler.pendingCount).toBe(0)
  })
})
