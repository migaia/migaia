import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  admitAbortSignal,
  createAbortTimeoutSignal,
  createConcurrencyLimiter,
  createManualScheduler,
  deferred,
  hostRethrowReporter,
  raceWithAbort,
  retry,
  sleep,
  toPromise,
  withTimeout
} from '../src/promise.js'

/** Creates a manually triggered signal whose cancellation reason getter is hostile. */
const createHostileReasonSignal = (cause: Error) => {
  let aborted = false
  let listener: (() => void) | undefined
  return {
    signal: {
      get aborted(): boolean {
        return aborted
      },
      get reason(): never {
        throw cause
      },
      addEventListener: (_type: 'abort', callback: () => void): void => {
        listener = callback
      },
      removeEventListener: (): void => undefined
    },
    abort: (): void => {
      aborted = true
      listener?.()
    }
  }
}

describe('promise primitives', () => {
  it('admits only structural signals, reads aborted once, and never reads reason', () => {
    const reasonFailure = new Error('reason must remain unread')
    const reads = { aborted: 0, reason: 0 }
    const signal = {
      get aborted(): boolean {
        reads.aborted += 1
        return false
      },
      get reason(): never {
        reads.reason += 1
        throw reasonFailure
      },
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined
    }
    expect(admitAbortSignal(signal)).toEqual({ kind: 'valid', signal, aborted: false })
    expect(reads).toEqual({ aborted: 1, reason: 0 })
  })

  it('classifies hostile and malformed signal candidates without throwing', () => {
    const abortedFailure = new Error('aborted getter failed')
    const listenerFailure = new Error('listener getter failed')
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()

    expect(admitAbortSignal(null)).toEqual({ kind: 'invalid', reason: 'not-object' })
    expect(admitAbortSignal([])).toEqual({ kind: 'invalid', reason: 'not-object' })
    expect(admitAbortSignal(revoked.proxy)).toMatchObject({
      kind: 'invalid',
      reason: 'not-object',
      cause: expect.any(TypeError)
    })
    expect(
      admitAbortSignal({
        aborted: 'false',
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined
      })
    ).toEqual({ kind: 'invalid', reason: 'aborted-not-boolean' })
    expect(
      admitAbortSignal({
        get aborted(): never {
          throw abortedFailure
        },
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined
      })
    ).toEqual({ kind: 'invalid', reason: 'aborted-threw', cause: abortedFailure })
    expect(
      admitAbortSignal({
        aborted: false,
        get addEventListener(): never {
          throw listenerFailure
        },
        removeEventListener: (): void => undefined
      })
    ).toEqual({ kind: 'invalid', reason: 'listener-not-function', cause: listenerFailure })
    expect(
      admitAbortSignal({
        aborted: false,
        addEventListener: undefined,
        removeEventListener: (): void => undefined
      })
    ).toEqual({ kind: 'invalid', reason: 'listener-not-function' })
  })

  it('UT-T145 normalizes synchronous values without deferring the computation', async () => {
    let calls = 0
    const pending = toPromise(() => {
      calls += 1
      return 42
    })

    expect(calls).toBe(1)
    await expect(pending).resolves.toBe(42)
    expect(calls).toBe(1)
  })

  it('UT-T145 assimilates thenables and preserves a native Promise identity', async () => {
    const native = Promise.resolve(42)
    // oxlint-disable-next-line unicorn/no-thenable -- Assimilation is the behavior under test.
    const thenable = Object.defineProperty({}, 'then', {
      value: (resolve: (value: number) => void) => resolve(43)
    }) as PromiseLike<number>

    expect(toPromise(() => native)).toBe(native)
    await expect(toPromise(() => thenable)).resolves.toBe(43)
  })

  it('UT-T145 converts a synchronous throw into rejection with exact reason identity', async () => {
    const reason = new Error('synchronous failure')
    let pending: Promise<never> | undefined

    expect(() => {
      pending = toPromise(() => {
        throw reason
      })
    }).not.toThrow()
    await expect(pending).rejects.toBe(reason)
  })

  it('SWV2-T47 snapshots abort-timeout options and contains a throwing timeout reason', () => {
    const scheduler = createManualScheduler()
    const timeoutFailure = new Error('timeout reason factory failed')
    const reads = { timeoutMs: 0, signal: 0, scheduler: 0, timeoutReason: 0, report: 0 }
    const options = {
      get timeoutMs() {
        reads.timeoutMs += 1
        return 5
      },
      get signal() {
        reads.signal += 1
        return undefined
      },
      get scheduler() {
        reads.scheduler += 1
        return scheduler
      },
      get timeoutReason() {
        reads.timeoutReason += 1
        return () => {
          throw timeoutFailure
        }
      },
      get report() {
        reads.report += 1
        return () => undefined
      }
    }

    const merged = createAbortTimeoutSignal(options)
    expect(reads).toEqual({ timeoutMs: 1, signal: 1, scheduler: 1, timeoutReason: 1, report: 1 })
    expect(() => scheduler.advance(5)).not.toThrow()
    expect(merged.signal?.aborted).toBe(true)
    expect(merged.signal?.reason).toBe(timeoutFailure)
    merged.dispose()
  })

  it('SWV2-T47 preserves abort getter counts and the original event reason', () => {
    const scheduler = createManualScheduler()
    const reason = new Error('external abort reason')
    let aborted = false
    let listener: (() => void) | undefined
    const calls = { aborted: 0, reason: 0, add: 0, remove: 0 }
    const signal = {
      get aborted() {
        calls.aborted += 1
        return aborted
      },
      get reason() {
        calls.reason += 1
        return reason
      },
      addEventListener: (_type: 'abort', callback: () => void) => {
        calls.add += 1
        listener = callback
      },
      removeEventListener: () => {
        calls.remove += 1
      }
    }

    const merged = createAbortTimeoutSignal({ signal, timeoutMs: 5, scheduler })
    expect(calls).toEqual({ aborted: 2, reason: 0, add: 1, remove: 0 })
    aborted = true
    listener?.()
    expect(merged.signal?.aborted).toBe(true)
    expect(merged.signal?.reason).toBe(reason)
    expect(calls).toEqual({ aborted: 2, reason: 1, add: 1, remove: 0 })
    merged.dispose()
    merged.dispose()
    expect(calls.remove).toBe(1)
  })

  it('SWV2-T47 rolls back when the post-subscribe abort observation fails', () => {
    const scheduler = createManualScheduler()
    const observationFailure = new Error('post-subscribe aborted getter failed')
    let abortedReads = 0
    let cancelCount = 0
    let removeCount = 0
    const signal = {
      get aborted(): boolean {
        abortedReads += 1
        if (abortedReads === 2) throw observationFailure
        return false
      },
      addEventListener: () => undefined,
      removeEventListener: () => {
        removeCount += 1
      }
    }
    const wrappedScheduler = {
      now: scheduler.now,
      schedule: (callback: () => void, delayMs: number) => {
        const task = scheduler.schedule(callback, delayMs)
        return {
          cancel: () => {
            cancelCount += 1
            task.cancel()
          }
        }
      }
    }

    expect(() =>
      createAbortTimeoutSignal({ signal, timeoutMs: 5, scheduler: wrappedScheduler })
    ).toThrow(observationFailure)
    expect(cancelCount).toBe(1)
    expect(removeCount).toBe(1)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('SWV2-T47 preserves pre-abort cleanup parity without subscribing', () => {
    const reason = new Error('already aborted')
    let addCount = 0
    let removeCount = 0
    const signal = {
      aborted: true,
      reason,
      addEventListener: () => {
        addCount += 1
      },
      removeEventListener: () => {
        removeCount += 1
      }
    }
    const merged = createAbortTimeoutSignal({ signal, timeoutMs: 5 })
    expect(merged.signal?.aborted).toBe(true)
    expect(merged.signal?.reason).toBe(reason)
    expect(addCount).toBe(0)
    merged.dispose()
    expect(removeCount).toBe(1)
  })

  it('SWV2-T48 distinguishes callback signal reachability from settlement ownership', async () => {
    const scheduler = createManualScheduler()
    let firstRequestSignal: unknown
    let secondRequestSignal: unknown
    const pending = withTimeout(
      ({ signal }) => {
        firstRequestSignal = signal
        secondRequestSignal = signal
        return new Promise<never>(() => undefined)
      },
      { timeoutMs: 5, scheduler }
    )

    expect(firstRequestSignal).toBe(secondRequestSignal)
    scheduler.advance(5)
    await expect(pending).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  })

  it('SWV2-T48 composes a standalone signal with settlement utilities without policy leakage', async () => {
    const scheduler = createManualScheduler()
    const timeoutReason = new Error('generic deadline')
    const merged = createAbortTimeoutSignal({
      timeoutMs: 5,
      scheduler,
      timeoutReason: () => timeoutReason
    })
    let firstListenerCalls = 0
    let secondListenerCalls = 0
    merged.signal?.addEventListener('abort', () => {
      firstListenerCalls += 1
    })
    merged.signal?.addEventListener('abort', () => {
      secondListenerCalls += 1
    })
    let settlementSignal: unknown
    const pending = raceWithAbort(
      ({ signal }) => {
        settlementSignal = signal
        return new Promise<never>(() => undefined)
      },
      { signal: merged.signal }
    )

    scheduler.advance(5)
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause: timeoutReason })
    expect(settlementSignal).not.toBe(merged.signal)
    expect(firstListenerCalls).toBe(1)
    expect(secondListenerCalls).toBe(1)
    merged.dispose()
  })

  it('SWV2-T48 keeps the signal primitive runtime-neutral and storage-policy free', () => {
    const source = readFileSync(new URL('../src/promise.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('@migaia/storage')
    expect(source).not.toContain('StorageContractError')
    expect(createAbortTimeoutSignal.name).toBe('createAbortTimeoutSignal')
  })

  it('SWV2-T48 reports cleanup under its signal-only operation identity', () => {
    const cleanupFailure = new Error('signal cleanup failed')
    const reports: unknown[] = []
    const merged = createAbortTimeoutSignal({
      timeoutMs: 5,
      scheduler: {
        now: () => 0,
        schedule: () => ({
          cancel: () => {
            throw cleanupFailure
          }
        })
      },
      report: (error, context) => reports.push({ error, context })
    })
    merged.dispose()
    expect(reports).toEqual([
      {
        error: cleanupFailure,
        context: { operation: 'abort-timeout-signal', phase: 'cleanup' }
      }
    ])
  })

  it('races a lazy operation against abort and forwards the reason', async () => {
    const controller = new AbortController()
    let operationSignal!: { readonly aborted: boolean; readonly reason?: unknown }
    const pending = raceWithAbort(
      ({ signal }) => {
        operationSignal = signal
        return new Promise<never>(() => {})
      },
      { signal: controller.signal }
    )
    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(pending).rejects.toMatchObject({ source: '@migaia/utils', code: 'ABORTED' })
    expect(operationSignal.aborted).toBe(true)
    expect(operationSignal.reason).toBe(reason)
  })

  it('reports a late rejection after abort exactly once', async () => {
    const controller = new AbortController()
    let rejectOperation!: (reason: unknown) => void
    const reports: unknown[] = []
    const pending = raceWithAbort(
      () => new Promise<never>((_, reject) => (rejectOperation = reject)),
      { signal: controller.signal, report: (error) => reports.push(error) }
    )
    controller.abort(new Error('abort'))
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    const late = new Error('late')
    rejectOperation(late)
    await Promise.resolve()
    expect(reports).toEqual([late])
  })

  it('contains a hostile abort reason getter without stranding the race', async () => {
    const cause = new Error('hostile abort reason getter')
    let aborted = false
    let listener: (() => void) | undefined
    const signal = {
      get aborted(): boolean {
        return aborted
      },
      get reason(): never {
        throw cause
      },
      addEventListener: (_type: 'abort', callback: () => void): void => {
        listener = callback
      },
      removeEventListener: (): void => undefined
    }
    const pending = raceWithAbort(() => new Promise<never>(() => undefined), { signal })
    aborted = true
    listener?.()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause })
  })

  it('contains hostile abort reasons across sleep, timeout, and retry', async () => {
    const starts = [
      [
        'sleep',
        (signal: ReturnType<typeof createHostileReasonSignal>['signal']) =>
          sleep(60_000, { signal })
      ],
      [
        'timeout',
        (signal: ReturnType<typeof createHostileReasonSignal>['signal']) =>
          withTimeout(() => new Promise<never>(() => undefined), { timeoutMs: 60_000, signal })
      ],
      [
        'retry',
        (signal: ReturnType<typeof createHostileReasonSignal>['signal']) =>
          retry(() => new Promise<never>(() => undefined), {
            maxAttempts: 1,
            shouldRetry: () => false,
            signal
          })
      ]
    ] as const
    for (const [label, start] of starts) {
      const cause = new Error('hostile shared abort reason')
      const controlled = createHostileReasonSignal(cause)
      const pending = start(controlled.signal)
      controlled.abort()
      await expect(pending, label).rejects.toMatchObject({ code: 'ABORTED', cause })
    }
  })

  it('snapshots limiter signal and contains hostile queued abort reasons', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1, report: () => undefined })
    let release!: () => void
    const active = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const cause = new Error('hostile limiter abort reason')
    const controlled = createHostileReasonSignal(cause)
    let signalReads = 0
    const queued = limiter.run(() => 'unexpected', {
      get signal() {
        signalReads += 1
        return controlled.signal
      }
    })
    controlled.abort()
    await expect(queued).rejects.toBe(cause)
    expect(signalReads).toBe(1)
    release()
    await active
    await limiter.dispose()
  })

  it('can report abort cleanup failures without replacing the operation result', async () => {
    const reports: unknown[] = []
    const signal = {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {
        throw new Error('cleanup')
      }
    }
    await expect(
      raceWithAbort(() => 'value', {
        signal,
        cleanupPolicy: 'report',
        report: (error) => reports.push(error)
      })
    ).resolves.toBe('value')
    expect(reports).toHaveLength(1)
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

  it('limits active work and rejects queued work on close', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let release!: () => void
    const first = limiter.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const second = limiter.run(() => 'second')
    expect(limiter.activeCount).toBe(1)
    expect(limiter.pendingCount).toBe(1)
    const closed = new Error('closed')
    limiter.close(closed)
    await expect(second).rejects.toBe(closed)
    release()
    await first
    await limiter.dispose()
    expect(limiter.activeCount).toBe(0)
  })

  it('starts a fresh whenIdle epoch after a previous idle settlement', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let release!: () => void
    const first = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const firstIdle = limiter.whenIdle()
    await Promise.resolve()
    release()
    await first
    await firstIdle

    let secondRelease!: () => void
    const second = limiter.run(() => new Promise<void>((resolve) => (secondRelease = resolve)))
    const secondIdle = limiter.whenIdle()
    let settled = false
    void secondIdle.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    secondRelease()
    await second
    await secondIdle
    await limiter.dispose()
  })

  it('does not replace a pending whenIdle waiter when dispose is called', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let release!: () => void
    const running = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const idle = limiter.whenIdle()
    const disposed = limiter.dispose()
    await Promise.resolve()
    release()
    await running
    await expect(idle).resolves.toBeUndefined()
    await expect(disposed).resolves.toBeUndefined()
  })

  it('snapshots limiter option getters exactly once at construction', async () => {
    let concurrencyReads = 0
    let reportReads = 0
    const limiter = createConcurrencyLimiter({
      get concurrency() {
        concurrencyReads += 1
        return 1
      },
      get report() {
        reportReads += 1
        return undefined
      }
    } as never)
    expect(concurrencyReads).toBe(1)
    expect(reportReads).toBe(1)
    await limiter.dispose()
  })

  it('snapshots a run signal getter exactly once before admission', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let signalReads = 0
    const signal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    } as never
    const runOptions = {
      get signal() {
        signalReads += 1
        return signal
      }
    } as never
    const pending = limiter.run(() => 'ok', runOptions)
    await expect(pending).resolves.toBe('ok')
    expect(signalReads).toBe(1)
    await limiter.dispose()
  })

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

  it('exports a host reporter without returning a rejected Promise', () => {
    expect(typeof hostRethrowReporter).toBe('function')
    expect(hostRethrowReporter).not.toBe(console.error)
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

  it('cleans queued abort listeners and preserves FIFO queue admission', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    let release!: () => void
    const first = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const controller = new AbortController()
    const second = limiter.run(() => 'never', { signal: controller.signal as never })
    controller.abort('queued-stop')
    await expect(second).rejects.toBe('queued-stop')
    release()
    await first
    await limiter.dispose()
    expect(limiter.pendingCount).toBe(0)
  })

  it('reports hostile queued-listener cleanup without losing close settlement', async () => {
    const reports: unknown[] = []
    const limiter = createConcurrencyLimiter({
      concurrency: 1,
      report: (error) => reports.push(error)
    })
    let release!: () => void
    const active = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const signal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => {
        throw new Error('listener cleanup failed')
      }
    } as {
      aborted: boolean
      addEventListener: (type: 'abort', listener: () => void) => void
      removeEventListener: () => never
    }
    const pending = limiter.run(() => 'never', { signal })
    const reason = new Error('closed')
    expect(() => limiter.close(reason)).not.toThrow()
    await expect(pending).rejects.toBe(reason)
    expect(reports).toHaveLength(1)
    release()
    await active
    await limiter.dispose()
  })

  it('uses tagged utils errors for reasonless abort and limiter close', async () => {
    const limiter = createConcurrencyLimiter({ concurrency: 1 })
    await expect(
      limiter.run(() => 'never', { signal: { aborted: true, reason: undefined } as never })
    ).rejects.toMatchObject({
      source: '@migaia/utils',
      code: 'ABORTED'
    })
    let release!: () => void
    const active = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const pending = limiter.run(() => 'never')
    limiter.close()
    await expect(pending).rejects.toMatchObject({
      source: '@migaia/utils',
      code: 'LIMITER_CLOSED'
    })
    release()
    await active
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
