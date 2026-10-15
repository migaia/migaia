import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { Resource } from '../src/index.js'
import { flushAsync } from './helpers.js'

describe('Suspense request wakeups', () => {
  it('RSB-T1 shares one pending Promise and admits cancellation between immediate wakeups', async () => {
    /** Manual deadlines prove Suspense cannot consume an unbounded microtask queue. */
    const scheduler = createManualScheduler()
    /** Every attempt throws a new already-fulfilled Promise, the reported starvation case. */
    const fetcher = vi.fn(() => {
      throw Promise.resolve()
    })
    /** Passive idle cleanup must not cancel the request under observation. */
    const resource = new Resource(fetcher, createRuntime(), { scheduler, keepAlive: true })
    /** All reads during this request retain its exact pending identity. */
    const pending = resource.promise
    await flushAsync()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(scheduler.pendingCount).toBe(1)
    expect(resource.promise).toBe(pending)
    scheduler.advance(0)
    await flushAsync()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(resource.promise).toBe(pending)
    /** Observe the existing AbortError contract before cancelling the active wait. */
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    resource.cancel()
    await rejected
    expect(scheduler.pendingCount).toBe(0)
    scheduler.advance(100)
    await flushAsync()
    expect(fetcher).toHaveBeenCalledTimes(2)
    resource.dispose()
  })

  it('RSB-T2 permits multiple Suspense stages without consuming the ordinary retry budget', async () => {
    /** Each settled dependency explicitly admits one next attempt. */
    const scheduler = createManualScheduler()
    /** This policy must never see a Suspense dependency as a fetch failure. */
    const retry = vi.fn(() => false)
    /** Two independent stages may complete before the fetcher finally has a value. */
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => {
        throw Promise.resolve()
      })
      .mockImplementationOnce(() => {
        throw Promise.resolve()
      })
      .mockReturnValue(42)
    /** The same request remains pending through both stages. */
    const resource = new Resource(fetcher, createRuntime(), { scheduler, retry, keepAlive: true })
    /** Request identity is independent of each thrown dependency's identity. */
    const pending = resource.promise
    for (let i = 0; i < 2; i++) {
      await flushAsync()
      expect(resource.promise).toBe(pending)
      expect(scheduler.pendingCount).toBe(1)
      scheduler.advance(0)
    }
    await expect(pending).resolves.toBe(42)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(retry).not.toHaveBeenCalled()
    expect(scheduler.pendingCount).toBe(0)
    resource.dispose()
  })
})
