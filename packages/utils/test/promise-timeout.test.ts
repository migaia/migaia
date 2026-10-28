import { describe, expect, it, vi } from 'vitest'

import { raceWithAbort, withTimeout } from '../src/promise.ts'
import { createManualScheduler } from '../src/testing.ts'

describe('promise primitives', () => {
  it('timeout rejects with TimeoutError instead of its internal AbortError', async () => {
    const scheduler = createManualScheduler()
    const pending = withTimeout(() => new Promise<never>(() => undefined), {
      timeoutMs: 5,
      scheduler
    })
    scheduler.advance(5)
    await expect(pending).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED', scope: 'operation' })
  })

  it('deadline-only timeout can avoid allocating an AbortController', async () => {
    const original = globalThis.AbortController
    let allocations = 0
    class CountingAbortController extends AbortController {
      constructor() {
        super()
        allocations += 1
      }
    }
    vi.stubGlobal('AbortController', CountingAbortController)
    try {
      const scheduler = createManualScheduler()
      const pending = withTimeout(() => 'done', {
        timeoutMs: 5,
        scheduler,
        cooperativeCancellation: false
      })
      await expect(pending).resolves.toBe('done')
      expect(allocations).toBe(0)
    } finally {
      vi.stubGlobal('AbortController', original)
    }
  })

  it('snapshots timeout option getters exactly once before admission', async () => {
    const scheduler = createManualScheduler()
    let timeoutReads = 0
    let signalReads = 0
    let signalsReads = 0
    const options = {
      get timeoutMs() {
        timeoutReads += 1
        return 5
      },
      get signal() {
        signalReads += 1
        return undefined
      },
      get signals() {
        signalsReads += 1
        return undefined
      },
      scheduler
    } as never
    const pending = withTimeout(() => new Promise<never>(() => undefined), options)
    expect(timeoutReads).toBe(1)
    expect(signalReads).toBe(1)
    expect(signalsReads).toBe(1)
    scheduler.advance(5)
    await expect(pending).rejects.toMatchObject({ scope: 'operation' })
  })

  it('rolls back timeout timer and listeners when listener admission fails', async () => {
    let cancelCount = 0
    let calls = 0
    const pending = withTimeout(
      () => {
        calls += 1
        return 'unexpected'
      },
      {
        timeoutMs: 10,
        report: () => undefined,
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
            addEventListener: () => undefined,
            removeEventListener: () => undefined
          },
          {
            aborted: false,
            addEventListener: () => {
              throw new Error('timeout listener admission failed')
            },
            removeEventListener: () => undefined
          }
        ] as never
      }
    )
    await expect(pending).rejects.toThrow('timeout listener admission failed')
    expect(cancelCount).toBe(1)
    expect(calls).toBe(0)
  })

  it('does not start the factory when a synchronous scheduler wins zero timeout', async () => {
    let calls = 0
    const scheduler = {
      now: () => 0,
      schedule: (callback: () => void) => {
        callback()
        return { cancel: () => undefined }
      }
    }
    await expect(
      withTimeout(
        () => {
          calls += 1
          return 'unexpected'
        },
        { timeoutMs: 0, zeroTimeoutBehavior: 'start', scheduler }
      )
    ).rejects.toMatchObject({ scope: 'operation' })
    expect(calls).toBe(0)
  })

  it('reports exactly one late rejection after timeout', async () => {
    const scheduler = createManualScheduler()
    let rejectLate!: (error: unknown) => void
    const reports: unknown[] = []
    const pending = withTimeout(() => new Promise<never>((_, reject) => (rejectLate = reject)), {
      timeoutMs: 1,
      scheduler,
      report: (error) => reports.push(error)
    })
    scheduler.advance(1)
    await expect(pending).rejects.toMatchObject({ scope: 'operation' })
    const late = new Error('late')
    rejectLate(late)
    await Promise.resolve()
    expect(reports).toEqual([late])
  })

  it('does not report an operation that rejects with its own cancellation reason after timeout', async () => {
    const scheduler = createManualScheduler()
    const reports: unknown[] = []
    // Cooperative operations such as `fetch(url, { signal })` reject with `signal.reason`.
    const pending = withTimeout(
      ({ signal }) =>
        new Promise<never>((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        ),
      { timeoutMs: 1, scheduler, report: (error) => reports.push(error) }
    )
    scheduler.advance(1)
    await expect(pending).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    await Promise.resolve()
    await Promise.resolve()
    expect(reports).toEqual([])
  })

  it('propagates external abort to the timeout operation signal', async () => {
    const controller = new AbortController()
    let observed = false
    const pending = withTimeout(
      ({ signal }) => {
        signal.addEventListener('abort', () => {
          observed = true
        })
        return new Promise<never>(() => undefined)
      },
      { timeoutMs: 100, signal: controller.signal as never }
    )
    controller.abort('cancelled')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    expect(observed).toBe(true)
  })

  it('rejects with cleanup failure when the primary result is a value', async () => {
    const pending = withTimeout(() => 'done', {
      timeoutMs: 10,
      scheduler: {
        now: () => 0,
        schedule: () => ({
          cancel: () => {
            throw new Error('cancel failed')
          }
        })
      }
    })
    await expect(pending).rejects.toBeInstanceOf(Error)
  })

  it('aggregates cleanup failure with a primary rejection before settling', async () => {
    const primary = new Error('primary')
    const cleanup = new Error('cleanup')
    const pending = withTimeout(() => Promise.reject(primary), {
      timeoutMs: 10,
      scheduler: {
        now: () => 0,
        schedule: () => ({
          cancel: () => {
            throw cleanup
          }
        })
      }
    })
    await expect(pending).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof AggregateError &&
        error.errors[0] === primary &&
        error.errors[1] === cleanup
      )
    })
  })

  it('rejects with the cleanup error when the primary outcome is a value and only one cleanup fails', async () => {
    const cleanup = new Error('cleanup')
    const pending = withTimeout(() => 'value', {
      timeoutMs: 10,
      scheduler: {
        now: () => 0,
        schedule: () => ({
          cancel: () => {
            throw cleanup
          }
        })
      }
    })
    await expect(pending).rejects.toBe(cleanup)
  })
})

it('does not start a direct abort race after native pre-cancellation', async () => {
  /** The supported native signal is already cancelled before listener or business admission. */
  const controller = new AbortController()
  controller.abort()
  /** Only the real lazy operation can change this original observable business effect. */
  let started = false
  await expect(
    raceWithAbort(
      () => {
        started = true
        return Promise.resolve('late')
      },
      { signal: controller.signal }
    )
  ).rejects.toMatchObject({ code: 'ABORTED', cause: controller.signal.reason })
  expect(started).toBe(false)
})
