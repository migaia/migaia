import { afterEach, describe, expect, it } from 'vitest'
import { retry, RetryAttemptStart, type IRetryContext } from '../src/promise.js'
import { UtilsAbortError } from '../src/error.js'
import { createManualScheduler } from '../src/testing.js'

/** Host controller constructor restored after each allocation-counting case. */
const NativeAbortController = globalThis.AbortController

afterEach(() => {
  globalThis.AbortController = NativeAbortController
})

/** Replaces the host AbortController with a subclass that counts constructions. */
const countAbortControllers = (): { count: number } => {
  const counter = { count: 0 }
  globalThis.AbortController = class extends NativeAbortController {
    constructor() {
      super()
      counter.count += 1
    }
  }
  return counter
}

describe('retry attempt start', () => {
  it('keeps the default timing: sync without signals, one microtask with signals', async () => {
    const calls: string[] = []
    const plain = retry(() => calls.push('plain'), { maxAttempts: 1, shouldRetry: () => false })
    const signal = new AbortController().signal
    const linked = retry(() => calls.push('linked'), {
      maxAttempts: 1,
      shouldRetry: () => false,
      signal
    })
    expect(calls).toEqual(['plain'])
    await Promise.all([plain, linked])
    expect(calls).toEqual(['plain', 'linked'])
  })

  it('starts the first attempt synchronously with sync even when a signal is linked', async () => {
    const calls: string[] = []
    const pending = retry(() => calls.push('attempt'), {
      maxAttempts: 1,
      shouldRetry: () => false,
      signal: new AbortController().signal,
      attemptStart: RetryAttemptStart.sync
    })
    expect(calls).toEqual(['attempt'])
    await pending
  })

  it('starts the first attempt sync under a total deadline as well', async () => {
    const scheduler = createManualScheduler()
    const calls: string[] = []
    const pending = retry(() => calls.push('attempt'), {
      maxAttempts: 1,
      shouldRetry: () => false,
      totalTimeoutMs: 50,
      scheduler,
      signal: new AbortController().signal,
      attemptStart: RetryAttemptStart.sync
    })
    expect(calls).toEqual(['attempt'])
    await pending
  })

  it('defers each attempt by one microtask with microtask', async () => {
    const calls: number[] = []
    const pending = retry(({ attempt }) => calls.push(attempt), {
      maxAttempts: 1,
      shouldRetry: () => false,
      attemptStart: RetryAttemptStart.microtask
    })
    expect(calls).toEqual([])
    await pending
    expect(calls).toEqual([1])
  })

  it('defers each attempt to a scheduler task with macrotask', async () => {
    const scheduler = createManualScheduler()
    const calls: number[] = []
    const pending = retry(({ attempt }) => calls.push(attempt), {
      maxAttempts: 1,
      shouldRetry: () => false,
      scheduler,
      attemptStart: RetryAttemptStart.macrotask
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual([])
    scheduler.advance(0)
    await pending
    expect(calls).toEqual([1])
  })

  it('lets an abort during a deferred start win before the attempt runs', async () => {
    const scheduler = createManualScheduler()
    const controller = new AbortController()
    let calls = 0
    const pending = retry(
      () => {
        calls += 1
      },
      {
        maxAttempts: 1,
        shouldRetry: () => false,
        scheduler,
        signal: controller.signal,
        attemptStart: RetryAttemptStart.macrotask
      }
    )
    const reason = new Error('stop')
    controller.abort(reason)
    scheduler.advance(0)
    const error = await pending.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(UtilsAbortError)
    expect((error as UtilsAbortError).cause).toBe(reason)
    expect(calls).toBe(0)
  })

  it('rejects an unknown attemptStart with INVALID_ARGUMENT before any attempt', async () => {
    let calls = 0
    const error = await retry(
      () => {
        calls += 1
      },
      {
        maxAttempts: 1,
        shouldRetry: () => false,
        attemptStart: 'later' as RetryAttemptStart
      }
    ).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(calls).toBe(0)
  })
})

describe('retry beforeRetry', () => {
  it('awaits beforeRetry after shouldRetry and before the delay and next attempt', async () => {
    const scheduler = createManualScheduler()
    const order: string[] = []
    const failure = new Error('first')
    let release!: () => void
    const pending = retry(
      ({ attempt }) => {
        order.push(`attempt ${attempt}`)
        if (attempt === 1) throw failure
        return 'done'
      },
      {
        maxAttempts: 2,
        scheduler,
        shouldRetry: () => {
          order.push('shouldRetry')
          return true
        },
        beforeRetry: (error, context) => {
          order.push(`beforeRetry ${context.attempt}/${context.maxAttempts}`)
          expect(error).toBe(failure)
          return new Promise<void>((resolve) => {
            release = resolve
          })
        },
        delay: () => {
          order.push('delay')
          return 5
        }
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['attempt 1', 'shouldRetry', 'beforeRetry 1/2'])
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(order).toEqual(['attempt 1', 'shouldRetry', 'beforeRetry 1/2', 'delay'])
    scheduler.advance(5)
    await expect(pending).resolves.toBe('done')
    expect(order.at(-1)).toBe('attempt 2')
  })

  it('ends the run with the beforeRetry rejection unchanged', async () => {
    const hookError = new Error('not ready')
    let attempts = 0
    const error = await retry(
      () => {
        attempts += 1
        throw new Error('attempt failed')
      },
      {
        maxAttempts: 3,
        shouldRetry: () => true,
        beforeRetry: () => Promise.reject(hookError)
      }
    ).catch((caught: unknown) => caught)
    expect(error).toBe(hookError)
    expect(attempts).toBe(1)
  })

  it('does not call beforeRetry when shouldRetry declines or attempts are exhausted', async () => {
    let hooks = 0
    await retry(
      () => {
        throw new Error('fail')
      },
      { maxAttempts: 2, shouldRetry: () => false, beforeRetry: () => void (hooks += 1) }
    ).catch(() => undefined)
    await retry(
      () => {
        throw new Error('fail')
      },
      { maxAttempts: 1, shouldRetry: () => true, beforeRetry: () => void (hooks += 1) }
    ).catch(() => undefined)
    expect(hooks).toBe(0)
  })

  it('stops a pending beforeRetry on outside abort with UtilsAbortError', async () => {
    const controller = new AbortController()
    const reason = new Error('cancel')
    const pending = retry(
      () => {
        throw new Error('fail')
      },
      {
        maxAttempts: 2,
        signal: controller.signal,
        shouldRetry: () => true,
        beforeRetry: () => new Promise<void>(() => undefined)
      }
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort(reason)
    const error = await pending.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(UtilsAbortError)
    expect((error as UtilsAbortError).cause).toBe(reason)
  })
})

describe('retry lazy attempt signal', () => {
  it('allocates no AbortController for attempts that never read their signal', async () => {
    const signal = new AbortController().signal
    const counter = countAbortControllers()
    await retry(() => 1, { maxAttempts: 1, shouldRetry: () => false, signal })
    await retry(() => 1, { maxAttempts: 1, shouldRetry: () => false })
    expect(counter.count).toBe(0)
  })

  it('gives a late reader an aborted signal carrying the outside abort reason', async () => {
    const controller = new AbortController()
    const reason = new Error('outside')
    let context: IRetryContext | undefined
    const pending = retry(
      (attemptContext) => {
        context = attemptContext
        return new Promise<never>(() => undefined)
      },
      {
        maxAttempts: 1,
        shouldRetry: () => false,
        signal: controller.signal,
        attemptStart: RetryAttemptStart.sync
      }
    )
    controller.abort(reason)
    await expect(pending).rejects.toBeInstanceOf(UtilsAbortError)
    expect(context!.signal.aborted).toBe(true)
    expect(context!.signal.reason).toBe(reason)
  })

  it('aborts an already-read attempt signal with the total deadline error', async () => {
    const scheduler = createManualScheduler()
    let seen: unknown
    const pending = retry(
      ({ signal }) =>
        new Promise<never>(() => {
          signal.addEventListener('abort', () => {
            seen = signal.reason
          })
        }),
      { maxAttempts: 1, shouldRetry: () => false, scheduler, totalTimeoutMs: 10 }
    )
    scheduler.advance(10)
    await expect(pending).rejects.toMatchObject({ scope: 'total' })
    expect(seen).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  })
})
