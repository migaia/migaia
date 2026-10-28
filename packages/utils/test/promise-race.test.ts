import { describe, expect, it, vi } from 'vitest'

import {
  createConcurrencyLimiter,
  raceWithAbort,
  retry,
  sleep,
  withTimeout
} from '../src/promise.ts'

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
    await expect(pending).rejects.toMatchObject({ source: 'foundation.utils', code: 'ABORTED' })
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

  it('does not report an operation that rejects with its own cancellation reason after abort', async () => {
    const reports: unknown[] = []
    const controller = new AbortController()
    const acknowledge = ({ signal }: { readonly signal: AbortSignal }) =>
      new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      )
    const raced = raceWithAbort(acknowledge, {
      signal: controller.signal,
      report: (error) => reports.push(error)
    })
    const retried = retry(acknowledge, {
      maxAttempts: 1,
      signal: controller.signal as never,
      shouldRetry: () => false,
      report: (error) => reports.push(error)
    })
    controller.abort(new Error('user left'))
    await expect(raced).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(retried).rejects.toMatchObject({ code: 'ABORTED' })
    await Promise.resolve()
    await Promise.resolve()
    expect(reports).toEqual([])
  })
})

it('removes the earlier race listener once when a later signal registration fails', async () => {
  /** Actual listener identity proves rollback of the earlier successfully admitted signal. */
  const listeners = new Set<() => void>()
  /** The original earlier listener owns exactly one successful removal receipt. */
  let removed = 0
  /** The first registration succeeds before the second signal fails. */
  const first = {
    aborted: false,
    addEventListener: (_type: 'abort', listener: () => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: 'abort', listener: () => void) => {
      removed += 1
      listeners.delete(listener)
    }
  }
  /** The original native failure must remain reachable through the public admission error. */
  const failure = new Error('registration failed')
  /** A distinct signal creates the exact earlier-success/later-failure rollback topology. */
  const second = {
    aborted: false,
    addEventListener: () => {
      throw failure
    },
    removeEventListener: () => undefined
  }
  await expect(
    raceWithAbort(() => Promise.resolve('late'), { signals: [first, second] })
  ).rejects.toSatisfy((error: unknown) => error instanceof TypeError && error.cause === failure)
  expect(removed).toBe(1)
  expect(listeners.size).toBe(0)
})

it('retains the race result and exact host diagnostic when its cleanup reporter throws', async () => {
  /** The single remover failure stays distinct from the secondary reporter failure. */
  const cleanupFailure = new Error('remove failed')
  /** The same actual reporter failure must escape the canonical host queue by identity. */
  const reporterFailure = new Error('diagnostic failed')
  /** Only the real cleanup reporter appends the original diagnostic. */
  const diagnostics: unknown[] = []
  /** Capture the existing host exception queue without delivering its deliberate test throw. */
  const queued: (() => void)[] = []
  /** The existing queue owner remains observable and is restored after the business assertion. */
  const enqueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
    queued.push(task)
  })
  /** A supported structural signal fails only while releasing its actual race subscription. */
  const signal = {
    aborted: false,
    addEventListener: () => undefined,
    removeEventListener: () => {
      throw cleanupFailure
    }
  }
  try {
    await expect(
      raceWithAbort(() => Promise.resolve('ok'), {
        signal,
        cleanupPolicy: 'report',
        report: (error) => {
          diagnostics.push(error)
          throw reporterFailure
        }
      })
    ).resolves.toBe('ok')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toBe(cleanupFailure)
    expect(queued).toHaveLength(1)
    /** Execute the one real queued callback once, retaining its exact thrown native instance. */
    let thrown: unknown
    try {
      queued[0]!()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(reporterFailure)
  } finally {
    enqueue.mockRestore()
  }
})
