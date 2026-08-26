import { describe, expect, it, vi } from 'vitest'
import { boundedWait } from '../src/bounded-wait.js'
import { systemScheduler, type ILifecycleScheduler } from '../src/scheduler.js'

const deferred = <T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('L-T16 boundedWait: task winning vs timeout winning', () => {
  it('rejects invalid deadline before reading or scheduling injected time', async () => {
    const now = vi.fn(() => 0)
    const schedule = vi.fn(() => ({ cancel: vi.fn() }))
    const scheduler: ILifecycleScheduler = { now, schedule }
    await expect(boundedWait(Promise.resolve(), Number.NaN, { scheduler })).rejects.toMatchObject({
      code: 'INVALID_OPTION'
    })
    expect(now).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('returns false for a past deadline without scheduling', async () => {
    const schedule = vi.fn(() => ({ cancel: vi.fn() }))
    const scheduler: ILifecycleScheduler = { now: () => 10, schedule }
    await expect(boundedWait(new Promise<void>(() => {}), 5, { scheduler })).resolves.toBe(false)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('contains an already-rejected task when a past deadline returns early', async () => {
    const rejection = new Error('already failed')
    const schedule = vi.fn(() => ({ cancel: vi.fn() }))
    const scheduler: ILifecycleScheduler = { now: () => 10, schedule }
    await expect(boundedWait(Promise.reject(rejection), 5, { scheduler })).resolves.toBe(false)
    expect(schedule).not.toHaveBeenCalled()
  })

  it('schedules zero delay when deadline exactly equals scheduler now', async () => {
    const cancel = vi.fn()
    const schedule = vi.fn((callback: () => void) => {
      callback()
      return { cancel }
    })
    const scheduler: ILifecycleScheduler = { now: () => 10, schedule }
    await expect(boundedWait(new Promise<void>(() => {}), 10, { scheduler })).resolves.toBe(false)
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 0)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('preserves scheduler now receiver and contains task rejection when now throws', async () => {
    const rejection = new Error('late failure')
    const schedule = vi.fn(() => ({ cancel: vi.fn() }))
    const scheduler = {
      now(this: unknown): number {
        expect(this).toBe(scheduler)
        throw new Error('clock failed')
      },
      schedule
    } satisfies ILifecycleScheduler
    await expect(boundedWait(Promise.reject(rejection), 5, { scheduler })).rejects.toThrow(
      'clock failed'
    )
    expect(schedule).not.toHaveBeenCalled()
  })
  it('returns true when the task resolves before the deadline', async () => {
    const { promise, resolve } = deferred<void>()
    const p = boundedWait(promise, systemScheduler.now() + 5000)
    resolve()
    await expect(p).resolves.toBe(true)
  })

  it('returns false without cancelling the task when the deadline is already past', async () => {
    const { promise, resolve } = deferred<void>()
    const won = await boundedWait(promise, systemScheduler.now() - 1)
    expect(won).toBe(false)
    // the task is not cancelled — it can still resolve later and must be observed, not swallowed.
    resolve()
    await promise
  })

  it('propagates the task rejection when it rejects before the deadline', async () => {
    const { promise, reject } = deferred<void>()
    const p = boundedWait(promise, systemScheduler.now() + 5000)
    reject(new Error('task failed'))
    await expect(p).rejects.toThrow('task failed')
  })

  it('a late rejection after the deadline already elapsed does not produce an unhandled rejection', async () => {
    const { promise, reject } = deferred<void>()
    const won = await boundedWait(promise, systemScheduler.now() - 1)
    expect(won).toBe(false)
    reject(new Error('late failure, must be observed'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    // Reaching here without a process-level unhandledRejection proves LG-R5-3 held.
    expect(true).toBe(true)
  })

  it('clears its own timer once the task wins the race (no dangling timer)', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { promise, resolve } = deferred<void>()
    resolve()
    await boundedWait(promise, systemScheduler.now() + 5000)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
    clearTimeoutSpy.mockRestore()
  })
})
