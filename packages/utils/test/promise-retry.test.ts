import { describe, expect, it } from 'vitest'

import { deferred, retry, withTimeout } from '../src/promise.ts'
import { createManualScheduler } from '../src/testing.ts'

describe('promise primitives', () => {
  it('does not start an attempt after the total deadline is exhausted', async () => {
    const scheduler = createManualScheduler()
    let attempts = 0
    await expect(
      retry(
        () => {
          attempts += 1
          throw new Error('fail')
        },
        { maxAttempts: 3, totalTimeoutMs: 0, scheduler, shouldRetry: () => true }
      )
    ).rejects.toMatchObject({ scope: 'total' })
    expect(attempts).toBe(0)
  })

  it('rejects retry before admission when an external signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort('stop')
    let calls = 0
    await expect(
      retry(
        () => {
          calls += 1
          return 'never'
        },
        { maxAttempts: 2, signal: controller.signal as never, shouldRetry: () => true }
      )
    ).rejects.toMatchObject({ code: 'ABORTED' })
    expect(calls).toBe(0)
  })

  it('snapshots retry option getters exactly once at entry', async () => {
    let maxAttemptsReads = 0
    let timeoutReads = 0
    let policyReads = 0
    const options = {
      get maxAttempts() {
        maxAttemptsReads += 1
        return 1
      },
      get totalTimeoutMs() {
        timeoutReads += 1
        return undefined
      },
      get shouldRetry() {
        policyReads += 1
        return () => false
      }
    } as never
    await expect(retry(() => 'ok', options)).resolves.toBe('ok')
    expect(maxAttemptsReads).toBe(1)
    expect(timeoutReads).toBe(1)
    expect(policyReads).toBe(1)
  })

  it('stops a hanging retry operation at the total deadline', async () => {
    const scheduler = createManualScheduler()
    const pending = retry(() => new Promise<never>(() => undefined), {
      maxAttempts: 2,
      totalTimeoutMs: 10,
      scheduler,
      shouldRetry: () => true
    })
    scheduler.advance(10)
    await expect(pending).rejects.toMatchObject({ scope: 'total', code: 'DEADLINE_EXCEEDED' })
  })

  it('rejects retry timeout configuration before operation or policy admission', async () => {
    let operations = 0
    let policies = 0
    await expect(
      retry(
        () => {
          operations += 1
          return 'never'
        },
        {
          maxAttempts: 2,
          totalTimeoutMs: -1,
          shouldRetry: () => {
            policies += 1
            return true
          }
        }
      )
    ).rejects.toMatchObject({ name: 'RangeError' })
    expect(operations).toBe(0)
    expect(policies).toBe(0)
  })

  it('propagates external abort during retry backoff', async () => {
    const controller = new AbortController()
    const scheduler = createManualScheduler()
    let attempts = 0
    const pending = retry(
      () => {
        attempts += 1
        throw new Error('retry')
      },
      {
        maxAttempts: 3,
        delay: 10,
        scheduler,
        signal: controller.signal as never,
        report: () => undefined,
        shouldRetry: () => true
      }
    )
    await Promise.resolve()
    controller.abort('cancelled')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    expect(attempts).toBe(1)
  })

  it('passes external abort to retry operations without a deadline', async () => {
    const controller = new AbortController()
    let observed = false
    const pending = retry(
      ({ signal }) => {
        signal.addEventListener('abort', () => {
          observed = true
        })
        return new Promise<never>(() => undefined)
      },
      { maxAttempts: 2, signal: controller.signal as never, shouldRetry: () => true }
    )
    await Promise.resolve()
    controller.abort('cancelled')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    expect(observed).toBe(true)
  })

  it('enforces the total retry deadline while retry policy is pending', async () => {
    const scheduler = createManualScheduler()
    const pending = retry(
      () => {
        throw new Error('retry')
      },
      {
        maxAttempts: 2,
        totalTimeoutMs: 10,
        scheduler,
        shouldRetry: () => new Promise<boolean>(() => undefined)
      }
    )
    scheduler.advance(10)
    await expect(pending).rejects.toMatchObject({ scope: 'total', code: 'DEADLINE_EXCEEDED' })
  })

  it('cancels a pending retry policy when externally aborted without a deadline', async () => {
    const controller = new AbortController()
    const pending = retry(
      () => {
        throw new Error('retry')
      },
      {
        maxAttempts: 2,
        signal: controller.signal as never,
        report: () => undefined,
        shouldRetry: () => new Promise<boolean>(() => undefined)
      }
    )
    await Promise.resolve()
    controller.abort('cancelled')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('reports late retry policy rejection after external cancellation', async () => {
    const controller = new AbortController()
    const reports: unknown[] = []
    let rejectPolicy!: (error: unknown) => void
    const pending = retry(
      () => {
        throw new Error('retry')
      },
      {
        maxAttempts: 2,
        signal: controller.signal as never,
        report: (error) => reports.push(error),
        shouldRetry: () => new Promise<boolean>((_, reject) => (rejectPolicy = reject))
      }
    )
    for (let index = 0; index < 6 && rejectPolicy === undefined; index += 1) await Promise.resolve()
    expect(rejectPolicy).toBeTypeOf('function')
    controller.abort('cancelled')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    const late = new Error('late policy')
    rejectPolicy(late)
    await Promise.resolve()
    await Promise.resolve()
    expect(reports).toEqual([late])
  })

  it('reports retry signal cleanup failure without replacing the abort result', async () => {
    let onAbort!: () => void
    const reports: unknown[] = []
    const signal = {
      aborted: false,
      addEventListener: (_type: 'abort', listener: () => void) => {
        onAbort = listener
      },
      removeEventListener: () => {
        throw new Error('retry listener cleanup failed')
      }
    } as {
      aborted: boolean
      addEventListener: (type: 'abort', listener: () => void) => void
      removeEventListener: () => never
    }
    const pending = retry(() => new Promise<never>(() => undefined), {
      maxAttempts: 1,
      signal: signal as never,
      report: (error, context) => reports.push({ error, context }),
      shouldRetry: () => false
    })
    await Promise.resolve()
    signal.aborted = true
    onAbort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    expect(reports).toEqual([
      { error: expect.any(Error), context: { operation: 'retry', phase: 'cleanup' } }
    ])
  })

  it('does not enter a backoff that exceeds the remaining total budget', async () => {
    const scheduler = createManualScheduler()
    let attempts = 0
    await expect(
      retry(
        () => {
          attempts += 1
          throw new Error('retry')
        },
        {
          maxAttempts: 3,
          totalTimeoutMs: 10,
          delay: 11,
          scheduler,
          shouldRetry: () => true
        }
      )
    ).rejects.toMatchObject({ scope: 'total' })
    expect(attempts).toBe(1)
    expect(scheduler.pendingCount).toBe(0)
  })
})

it('retains the deadline terminal after the original operation fulfills late', async () => {
  /** The existing scheduler owns the sole deadline and its released timer receipt. */
  const scheduler = createManualScheduler()
  /** This genuine operation completes only after its public deadline result has settled. */
  const operation = deferred<string>()
  /** Attach the original rejection observer before advancing the actual timer owner. */
  const pending = withTimeout(() => operation.promise, { timeoutMs: 1, scheduler })
  /** Preserve the first actual deadline instance for the post-completion identity assertion. */
  const terminal = pending.catch((error: unknown) => error)
  scheduler.advance(1)
  /** The first terminal remains owned by withTimeout rather than by its late operation. */
  const failure = await terminal
  expect(failure).toMatchObject({ code: 'DEADLINE_EXCEEDED', scope: 'operation' })
  operation.resolve('late')
  await operation.promise
  await expect(pending).rejects.toBe(failure)
  expect(scheduler.pendingCount).toBe(0)
})
