import { describe, expect, it } from 'vitest'

import { deferred, hostRethrowReporter, sleep, toPromise, withTimeout } from '../src/promise.ts'
import { createManualScheduler } from '../src/testing.ts'

describe('promise primitives', () => {
  it('normalizes synchronous values without deferring the computation', async () => {
    let calls = 0
    const pending = toPromise(() => {
      calls += 1
      return 42
    })

    expect(calls).toBe(1)
    await expect(pending).resolves.toBe(42)
    expect(calls).toBe(1)
  })

  it('assimilates thenables and preserves a native Promise identity', async () => {
    const native = Promise.resolve(42)
    // oxlint-disable-next-line unicorn/no-thenable -- Assimilation is the behavior under test.
    const thenable = Object.defineProperty({}, 'then', {
      value: (resolve: (value: number) => void) => resolve(43)
    }) as PromiseLike<number>

    expect(toPromise(() => native)).toBe(native)
    await expect(toPromise(() => thenable)).resolves.toBe(43)
  })

  it('converts a synchronous throw into rejection with exact reason identity', async () => {
    const reason = new Error('synchronous failure')
    let pending: Promise<never> | undefined

    expect(() => {
      pending = toPromise(() => {
        throw reason
      })
    }).not.toThrow()
    await expect(pending).rejects.toBe(reason)
  })

  it('sleep waits for the manual deadline and cleans up', async () => {
    const scheduler = createManualScheduler()
    let done = false
    const pending = sleep(10, { scheduler }).then(() => {
      done = true
    })
    expect(done).toBe(false)
    scheduler.advance(9)
    expect(done).toBe(false)
    scheduler.advance(1)
    await pending
    expect(done).toBe(true)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('snapshots sleep option getters exactly once before admission', async () => {
    const scheduler = createManualScheduler()
    let schedulerReads = 0
    let signalReads = 0
    let signalsReads = 0
    let unrefReads = 0
    const options = {
      get scheduler() {
        schedulerReads += 1
        return scheduler
      },
      get signal() {
        signalReads += 1
        return undefined
      },
      get signals() {
        signalsReads += 1
        return undefined
      },
      get unref() {
        unrefReads += 1
        return false
      }
    } as never
    const pending = sleep(1, options)
    expect(schedulerReads).toBe(1)
    expect(signalReads).toBe(1)
    expect(signalsReads).toBe(1)
    expect(unrefReads).toBe(1)
    scheduler.advance(1)
    await pending
  })

  it('settles sleep despite hostile cleanup and reports cleanup failures', async () => {
    const originalQueueMicrotask = globalThis.queueMicrotask
    const reported: unknown[] = []
    Object.defineProperty(globalThis, 'queueMicrotask', {
      configurable: true,
      value: (callback: () => void) => reported.push(callback)
    })
    try {
      const controller = new AbortController()
      const pending = sleep(10, {
        signal: controller.signal as never,
        scheduler: {
          now: () => 0,
          schedule: () => ({
            cancel: () => {
              throw new Error('sleep timer cleanup failed')
            }
          })
        }
      })
      controller.abort('cancelled')
      await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
      expect(reported).toHaveLength(1)
    } finally {
      Object.defineProperty(globalThis, 'queueMicrotask', {
        configurable: true,
        value: originalQueueMicrotask
      })
    }
  })

  it('rolls back sleep timer and listeners when listener admission fails', async () => {
    let cancelCount = 0
    let addCount = 0
    const pending = sleep(10, {
      scheduler: {
        now: () => 0,
        schedule: () => ({
          cancel: () => {
            cancelCount += 1
          }
        })
      },
      signals: [
        {
          aborted: false,
          addEventListener: () => {
            addCount += 1
          },
          removeEventListener: () => undefined
        },
        {
          aborted: false,
          addEventListener: () => {
            throw new Error('listener admission failed')
          },
          removeEventListener: () => undefined
        }
      ] as never
    })
    await expect(pending).rejects.toThrow('listener admission failed')
    expect(addCount).toBe(1)
    expect(cancelCount).toBe(1)
  })

  it('deferred preserves native first-settlement and Promise identity', async () => {
    const value = deferred<number>()
    const same = value.promise
    value.resolve(1)
    value.reject(new Error('late'))
    expect(value.promise).toBe(same)
    await expect(value.promise).resolves.toBe(1)
  })

  it('exports a host reporter without returning a rejected Promise', () => {
    expect(typeof hostRethrowReporter).toBe('function')
    expect(hostRethrowReporter).not.toBe(console.error)
  })

  it('rejects ambiguous signal and signals admission for sleep and timeout', async () => {
    const signal = { aborted: false } as never
    const scheduler = createManualScheduler()
    await expect(sleep(1, { signal, signals: [signal], scheduler })).rejects.toMatchObject({
      name: 'TypeError'
    })
    await expect(
      withTimeout(() => 'never', { timeoutMs: 1, signal, signals: [signal], scheduler })
    ).rejects.toMatchObject({ name: 'TypeError' })
  })
})
