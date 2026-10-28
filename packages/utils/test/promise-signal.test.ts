import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  admitAbortSignal,
  createAbortTimeoutSignal,
  raceWithAbort,
  sleep,
  withTimeout
} from '../src/promise.ts'
import { createManualScheduler } from '../src/testing.ts'

describe('promise primitives', () => {
  it.each(['withTimeout', 'raceWithAbort'] as const)(
    'stops signal admission after synchronous cancellation in %s',
    async (operation) => {
      /** Original RPC cancellation oracles require no later listener or business start. */
      const started = vi.fn(() => 'late')
      /** The first structural signal cancels synchronously during its real registration call. */
      const active = new Set<() => void>()
      /** A later signal must not acquire a listener after the result has already settled. */
      const laterAdded = vi.fn()
      /** Structural abort callbacks remain authoritative even when aborted stays false. */
      const first = {
        aborted: false,
        addEventListener: (_type: 'abort', listener: () => void) => {
          active.add(listener)
          listener()
        },
        removeEventListener: (_type: 'abort', listener: () => void) => {
          active.delete(listener)
        }
      }
      /** This signal exposes forbidden post-cancellation admission independently of operation IO. */
      const second = {
        aborted: false,
        addEventListener: laterAdded,
        removeEventListener: () => undefined
      }
      /** Both original public owners must stop inside the same listener-admission loop. */
      const pending =
        operation === 'withTimeout'
          ? withTimeout(started, {
              signals: [first, second],
              timeoutMs: 10,
              scheduler: createManualScheduler()
            })
          : raceWithAbort(started, { signals: [first, second] })
      await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
      expect(started).not.toHaveBeenCalled()
      expect(laterAdded).not.toHaveBeenCalled()
      expect(active.size).toBe(0)
    }
  )

  it.each(['sleep', 'withTimeout', 'raceWithAbort'] as const)(
    'rolls back partial signal registration in %s',
    async (operation) => {
      /** Registration can acquire a listener before the structural host reports failure. */
      const listeners = new Set<() => void>()
      /** Preserve the original registration failure through the cleanup boundary. */
      const cause = new Error('partial registration')
      /** Actual removals prove resource release, independently of Promise settlement. */
      let removed = 0
      /** Supported structural signal deliberately fails after acquiring the listener. */
      const signal = {
        aborted: false,
        addEventListener: (_type: 'abort', listener: () => void) => {
          listeners.add(listener)
          throw cause
        },
        removeEventListener: (_type: 'abort', listener: () => void) => {
          removed++
          listeners.delete(listener)
        }
      }
      /** Local clock avoids real timer ownership in the failing admission case. */
      const scheduler = createManualScheduler()
      /** Exercise the public boundary that must roll back its acquired listener. */
      const pending =
        operation === 'sleep'
          ? sleep(10, { signal, scheduler })
          : operation === 'withTimeout'
            ? withTimeout(() => 1, { timeoutMs: 10, signal, scheduler })
            : raceWithAbort(() => 1, { signal })
      await expect(pending).rejects.toSatisfy(
        (error: unknown) => error === cause || (error as Error).cause === cause
      )
      expect(listeners.size).toBe(0)
      expect(removed).toBe(1)
    }
  )

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

  it('snapshots abort-timeout options and contains a throwing timeout reason', () => {
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

  it('preserves abort getter counts and the original event reason', () => {
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

  it('rolls back when the post-subscribe abort observation fails', () => {
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

  it('preserves pre-abort cleanup parity without subscribing', () => {
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

  it('distinguishes callback signal reachability from settlement ownership', async () => {
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

  it('composes a standalone signal with settlement utilities without policy leakage', async () => {
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

  it('keeps the signal primitive runtime-neutral and storage-policy free', () => {
    const source =
      readFileSync(new URL('../src/promise.ts', import.meta.url), 'utf8') +
      readFileSync(new URL('../src/internal/promise-abort-timeout.ts', import.meta.url), 'utf8') +
      readFileSync(new URL('../src/internal/promise-abort.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('@migaia/storage')
    expect(source).not.toContain('StorageContractError')
    expect(createAbortTimeoutSignal.name).toBe('createAbortTimeoutSignal')
  })

  it('reports cleanup under its signal-only operation identity', () => {
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
})
