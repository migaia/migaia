import { describe, expect, it, vi } from 'vitest'
import { createDisposeTransaction, executeReleaseDescriptor } from '../src/dispose-transaction'
import { LifecycleErrorCode } from '../src/error-code.js'
import { LIFECYCLE_SOURCE } from '../src/errors.js'
import { systemScheduler } from '../src/scheduler.js'
import type { IReleaseContext, IReleaseDescriptor } from '../src/types'

const baseContext = (overrides: Partial<IReleaseContext> = {}): IReleaseContext => ({
  signal: new AbortController().signal,
  deadlineAt: undefined,
  report: vi.fn(),
  ...overrides
})

describe('L-T21 custom escape hatch', () => {
  it('skips graceful and force entirely when custom is present', async () => {
    const graceful = vi.fn()
    const force = vi.fn()
    const custom = vi.fn()
    const descriptor: IReleaseDescriptor = { graceful, force, custom }
    await executeReleaseDescriptor(descriptor, baseContext())
    expect(custom).toHaveBeenCalledTimes(1)
    expect(graceful).not.toHaveBeenCalled()
    expect(force).not.toHaveBeenCalled()
  })

  it("custom's error is returned and attributed to this item", async () => {
    const error = new Error('custom failed')
    const descriptor: IReleaseDescriptor = {
      force: vi.fn(),
      custom: () => {
        throw error
      }
    }
    const errors = await executeReleaseDescriptor(descriptor, baseContext())
    expect(errors).toEqual([error])
  })

  it('an async custom() is awaited', async () => {
    let resolved = false
    const descriptor: IReleaseDescriptor = {
      force: vi.fn(),
      custom: async () => {
        await Promise.resolve()
        resolved = true
      }
    }
    await executeReleaseDescriptor(descriptor, baseContext())
    expect(resolved).toBe(true)
  })
})

describe('AF-T62 direct release descriptor scheduler boundary', () => {
  it('snapshots a hostile context scheduler before invoking graceful', async () => {
    let reads = 0
    const scheduler = {
      now: () => 0,
      schedule: () => ({ cancel: () => {} })
    }
    const context = {
      signal: new AbortController().signal,
      deadlineAt: undefined,
      get scheduler() {
        reads++
        if (reads > 1) throw new Error('scheduler context was re-read')
        return scheduler
      },
      report: () => {}
    }

    await executeReleaseDescriptor(
      {
        graceful: (received) => {
          expect(received.scheduler).toBeDefined()
        },
        force: () => {}
      },
      context
    )

    expect(reads).toBe(1)
  })
})

describe('L-T22 graceful success stops the chain', () => {
  it('does not call force after graceful succeeds', async () => {
    const force = vi.fn()
    const descriptor: IReleaseDescriptor = { graceful: async () => undefined, force }
    const errors = await executeReleaseDescriptor(descriptor, baseContext())
    expect(errors).toEqual([])
    expect(force).not.toHaveBeenCalled()
  })

  it('a synchronous (non-thenable) graceful return also counts as success', async () => {
    const force = vi.fn()
    const descriptor: IReleaseDescriptor = { graceful: () => undefined, force }
    await executeReleaseDescriptor(descriptor, baseContext())
    expect(force).not.toHaveBeenCalled()
  })

  it('graceful and force share the same context object (deadline/signal/report)', async () => {
    let gracefulContext: IReleaseContext | undefined
    const context = baseContext()
    const descriptor: IReleaseDescriptor = {
      graceful: async (c) => {
        gracefulContext = c
      },
      force: vi.fn()
    }
    await executeReleaseDescriptor(descriptor, context)
    expect(gracefulContext).toBe(context)
  })
})

describe('L-T23 graceful timeout abandons waiting without cancelling it, then runs force', () => {
  it('proceeds to force once the deadline passes, without recording a graceful error', async () => {
    vi.useFakeTimers()
    try {
      let gracefulSettled = false
      const graceful = () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            gracefulSettled = true
            resolve()
          }, 10_000)
        })
      const force = vi.fn()
      const descriptor: IReleaseDescriptor = { graceful, gracefulTimeoutMs: 100, force }
      const promise = executeReleaseDescriptor(descriptor, baseContext())
      await vi.advanceTimersByTimeAsync(101)
      const errors = await promise
      expect(errors).toEqual([]) // timeout is silent, not recorded as an item error
      expect(force).toHaveBeenCalledTimes(1)
      expect(gracefulSettled).toBe(false) // graceful was not cancelled, just abandoned
    } finally {
      vi.useRealTimers()
    }
  })

  it('the graceful call keeps running in the background after abandonment (not cancelled)', async () => {
    vi.useFakeTimers()
    try {
      let gracefulResolved = false
      const graceful = () =>
        new Promise<void>((resolve) => setTimeout(() => resolve(), 5000)).then(() => {
          gracefulResolved = true
        })
      const descriptor: IReleaseDescriptor = { graceful, gracefulTimeoutMs: 100, force: vi.fn() }
      const promise = executeReleaseDescriptor(descriptor, baseContext())
      await vi.advanceTimersByTimeAsync(101)
      await promise
      expect(gracefulResolved).toBe(false)
      await vi.advanceTimersByTimeAsync(5000)
      expect(gracefulResolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('L-T24 graceful throwing still runs force', () => {
  it('records the graceful error and still calls force', async () => {
    const gracefulError = new Error('graceful failed')
    const force = vi.fn()
    const descriptor: IReleaseDescriptor = {
      graceful: () => {
        throw gracefulError
      },
      force
    }
    const errors = await executeReleaseDescriptor(descriptor, baseContext())
    expect(force).toHaveBeenCalledTimes(1)
    expect(errors).toContain(gracefulError)
  })

  it('an async graceful rejection also still runs force and is recorded', async () => {
    const gracefulError = new Error('async graceful failed')
    const force = vi.fn()
    const descriptor: IReleaseDescriptor = {
      graceful: async () => {
        throw gracefulError
      },
      force
    }
    const errors = await executeReleaseDescriptor(descriptor, baseContext())
    expect(force).toHaveBeenCalledTimes(1)
    expect(errors).toContain(gracefulError)
  })
})

describe('L-T25 force errors flow to the policy outcome without dangling rejections', () => {
  it("force's error is returned for the caller to fold into the policy sink", async () => {
    const forceError = new Error('force failed')
    const descriptor: IReleaseDescriptor = {
      force: () => {
        throw forceError
      }
    }
    const errors = await executeReleaseDescriptor(descriptor, baseContext())
    expect(errors).toEqual([forceError])
  })

  it('an async force rejection is caught, not left as an unhandled rejection', async () => {
    const descriptor: IReleaseDescriptor = {
      force: async () => Promise.reject(new Error('async force failed'))
    }
    const errors = await executeReleaseDescriptor(descriptor, baseContext())
    expect(errors).toHaveLength(1)
  })

  it('a transaction still reaches its finalize step (terminal) even when force fails, under collect policy', async () => {
    const transaction = createDisposeTransaction({ kind: 'plan' }, { errorPolicy: 'collect' })
    const result = await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: () => {
            throw new Error('force failed')
          }
        }
      }
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.source).toBe('a')
  })
})

describe('L-T26 IReleaseContext: report and signal', () => {
  it('report is invoked and a reporter throw is contained', async () => {
    const reportSpy = vi.fn(() => {
      throw new Error('reporter exploded')
    })
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'collect', report: reportSpy }
    )
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: (context) => {
            context.report('diagnostic, non-fatal')
          }
        }
      }
    ])
    expect(reportSpy).toHaveBeenCalledWith('diagnostic, non-fatal')
  })

  it('the closing signal reflects an already-aborted external signal for every item', async () => {
    const external = new AbortController()
    external.abort('closing')
    const seenAborted: boolean[] = []
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'collect', signal: external.signal }
    )
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: (c) => {
            seenAborted.push(c.signal.aborted)
          }
        }
      },
      {
        source: 'b',
        descriptor: {
          force: (c) => {
            seenAborted.push(c.signal.aborted)
          }
        }
      }
    ])
    expect(seenAborted).toEqual([true, true])
  })

  it('a signal that aborts mid-run is observable by later items', async () => {
    const external = new AbortController()
    const seenAborted: boolean[] = []
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'collect', signal: external.signal }
    )
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: (c) => {
            seenAborted.push(c.signal.aborted)
            external.abort('mid-run')
          }
        }
      },
      {
        source: 'b',
        descriptor: {
          force: (c) => {
            seenAborted.push(c.signal.aborted)
          }
        }
      }
    ])
    expect(seenAborted).toEqual([false, true])
  })
})

describe('L-T50 DisposeTransaction: signal registration and cleanup failures', () => {
  it('releases items and drains pending work when signal registration throws after storing', async () => {
    const registrationError = new Error('signal registration failed')
    const removalError = new Error('signal removal failed')
    const force = vi.fn()
    const drain = vi.fn(async () => undefined)
    let registeredListener: (() => void) | undefined
    const signal = {
      aborted: false,
      reason: 'closing',
      addEventListener: (_type: 'abort', listener: () => void) => {
        registeredListener = listener
        throw registrationError
      },
      removeEventListener: (_type: 'abort', listener: () => void) => {
        expect(listener).toBe(registeredListener)
        throw removalError
      }
    }
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'throw', signal, pending: { drain } }
    )

    let thrown: unknown
    try {
      await transaction.run([{ source: 'resource', descriptor: { force } }])
    } catch (error) {
      thrown = error
    }

    expect(force).toHaveBeenCalledTimes(1)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(thrown).toBe(registrationError)
    expect((thrown as { errors?: readonly unknown[] }).errors).toContain(removalError)
  })

  it('does not append a signal cleanup error to itself when it is the only primary', async () => {
    const cleanupError = new Error('signal cleanup failed')
    const signal = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(() => {
        throw cleanupError
      })
    }
    const transaction = createDisposeTransaction({ kind: 'plan' }, { errorPolicy: 'throw', signal })

    await expect(transaction.run([])).rejects.toBe(cleanupError)
    expect((cleanupError as { errors?: readonly unknown[] }).errors).toBeUndefined()
  })

  it('keeps remove failure secondary to an item primary and still reaches pending/finalize', async () => {
    const itemError = new Error('item failed')
    const removalError = new Error('remove failed')
    const drain = vi.fn(async () => undefined)
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(() => {
        throw removalError
      })
    }
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'throw', signal, pending: { drain } }
    )

    let thrown: unknown
    try {
      await transaction.run([
        {
          source: 'resource',
          descriptor: {
            force: () => {
              throw itemError
            }
          }
        }
      ])
    } catch (error) {
      thrown = error
    }

    expect(drain).toHaveBeenCalledTimes(1)
    expect(thrown).toBe(itemError)
    expect((thrown as { errors?: readonly unknown[] }).errors).toContain(removalError)
  })

  it('preserves collect policy for registration and removal failures', async () => {
    const registrationError = new Error('registration failed')
    const removalError = new Error('removal failed')
    let registeredListener: (() => void) | undefined
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: (_type: 'abort', listener: () => void) => {
        registeredListener = listener
        throw registrationError
      },
      removeEventListener: (_type: 'abort', listener: () => void) => {
        expect(listener).toBe(registeredListener)
        throw removalError
      }
    }
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'collect', signal }
    )

    const result = await transaction.run([{ source: 'resource', descriptor: { force: vi.fn() } }])
    expect(result.map((entry) => entry.error)).toEqual([registrationError, removalError])
  })

  it('removes a listener when the host invokes before storing it', async () => {
    let storedListener: (() => void) | undefined
    let removed = 0
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: (_type: 'abort', listener: () => void) => {
        listener()
        storedListener = listener
      },
      removeEventListener: (_type: 'abort', listener: () => void) => {
        if (listener === storedListener) removed += 1
      }
    }
    const transaction = createDisposeTransaction({ kind: 'plan' }, { signal })

    await transaction.run([])
    expect(removed).toBe(1)
  })

  it('keeps a callback-before-store cleanup failure as one primary error', async () => {
    const cleanupError = new Error('transaction retry cleanup failed')
    let storedListener: (() => void) | undefined
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: (_type: 'abort', listener: () => void) => {
        listener()
        storedListener = listener
      },
      removeEventListener: (_type: 'abort', listener: () => void) => {
        if (listener === storedListener) throw cleanupError
      }
    }
    const transaction = createDisposeTransaction({ kind: 'plan' }, { signal })

    await expect(transaction.run([])).rejects.toBe(cleanupError)
  })
})

describe('L-T14 DisposeTransaction: order mode', () => {
  it('uses an inert signal without allocating a controller when no external signal exists', async () => {
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
      let received: IReleaseContext | undefined
      const transaction = createDisposeTransaction({ kind: 'order' })
      await transaction.run([
        {
          source: 'test',
          descriptor: { graceful: (context) => void (received = context), force: () => undefined }
        }
      ])
      expect(allocations).toBe(0)
      expect(received?.signal.aborted).toBe(false)
    } finally {
      vi.stubGlobal('AbortController', original)
    }
  })

  it('groups by descending order, releasing higher-order items first', async () => {
    const calls: string[] = []
    const transaction = createDisposeTransaction({ kind: 'order' }, { errorPolicy: 'throw' })
    await transaction.run([
      {
        source: 'low',
        descriptor: {
          order: 0,
          force: () => {
            calls.push('low')
          }
        }
      },
      {
        source: 'high',
        descriptor: {
          order: 10,
          force: () => {
            calls.push('high')
          }
        }
      },
      {
        source: 'mid',
        descriptor: {
          order: 5,
          force: () => {
            calls.push('mid')
          }
        }
      }
    ])
    expect(calls).toEqual(['high', 'mid', 'low'])
  })

  it('items with equal (or omitted) order keep the caller-supplied relative sequence (LIFO input)', async () => {
    const calls: string[] = []
    const transaction = createDisposeTransaction({ kind: 'order' }, { errorPolicy: 'throw' })
    await transaction.run([
      {
        source: 'first-given',
        descriptor: {
          force: () => {
            calls.push('first-given')
          }
        }
      },
      {
        source: 'second-given',
        descriptor: {
          force: () => {
            calls.push('second-given')
          }
        }
      }
    ])
    expect(calls).toEqual(['first-given', 'second-given'])
  })

  it('a transaction created for order mode shares one absolute deadline across items', async () => {
    const deadlineAt = systemScheduler.now() + 100_000
    const seenDeadlines: (number | undefined)[] = []
    const transaction = createDisposeTransaction(
      { kind: 'order' },
      { errorPolicy: 'throw', deadlineAt }
    )
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: (c) => {
            seenDeadlines.push(c.deadlineAt)
          }
        }
      },
      {
        source: 'b',
        descriptor: {
          force: (c) => {
            seenDeadlines.push(c.deadlineAt)
          }
        }
      }
    ])
    expect(seenDeadlines).toEqual([deadlineAt, deadlineAt])
  })
})

describe('L-T15 DisposeTransaction: ordered-plan mode', () => {
  it('executes items strictly in the given sequence', async () => {
    const calls: string[] = []
    const transaction = createDisposeTransaction({ kind: 'plan' }, { errorPolicy: 'throw' })
    await transaction.run([
      {
        source: 'first',
        descriptor: {
          order: -100,
          force: () => {
            calls.push('first')
          }
        }
      },
      {
        source: 'second',
        descriptor: {
          order: 100,
          force: () => {
            calls.push('second')
          }
        }
      },
      {
        source: 'third',
        descriptor: {
          order: 0,
          force: () => {
            calls.push('third')
          }
        }
      }
    ])
    // `order` values would reorder this in `order` mode; `plan` mode must ignore them entirely.
    expect(calls).toEqual(['first', 'second', 'third'])
  })
})

describe('L-T53 Luna descriptor admission isolation', () => {
  it.each(['custom', 'graceful', 'force'] as const)(
    'plan mode keeps releasing later items when %s getter throws',
    async (field) => {
      const admissionError = new Error(`${field} getter failed`)
      const laterForce = vi.fn()
      const hostile: Record<string, unknown> = { force: vi.fn() }
      Object.defineProperty(hostile, field, {
        get: () => {
          throw admissionError
        }
      })
      const transaction = createDisposeTransaction({ kind: 'plan' }, { errorPolicy: 'collect' })

      const result = await transaction.run([
        { source: 'hostile', descriptor: hostile as IReleaseDescriptor },
        { source: 'later', descriptor: { force: laterForce } }
      ])

      expect(result).toEqual([{ source: 'hostile', error: admissionError }])
      expect(laterForce).toHaveBeenCalledTimes(1)
    }
  )

  it('plan mode never reads order and preserves input release order around hostile descriptors', async () => {
    const orderGetter = vi.fn(() => {
      throw new Error('plan order must not be read')
    })
    const calls: string[] = []
    const hostile = {
      force: () => {
        calls.push('hostile')
      }
    } as unknown as IReleaseDescriptor & {
      readonly order: number
    }
    Object.defineProperty(hostile, 'order', { get: orderGetter })
    const transaction = createDisposeTransaction({ kind: 'plan' }, { errorPolicy: 'collect' })

    const result = await transaction.run([
      { source: 'first', descriptor: hostile },
      {
        source: 'second',
        descriptor: {
          force: () => {
            calls.push('second')
          }
        }
      }
    ])

    expect(result).toEqual([])
    expect(calls).toEqual(['hostile', 'second'])
    expect(orderGetter).not.toHaveBeenCalled()
  })

  it.each(['throw', 'collect', 'report', 'firstError'] as const)(
    'plan admission failure follows %s policy while later release still runs',
    async (errorPolicy) => {
      const admissionError = new Error('descriptor admission failed')
      const laterForce = vi.fn()
      const report = vi.fn()
      const hostile = {} as Record<string, unknown>
      Object.defineProperty(hostile, 'force', {
        get: () => {
          throw admissionError
        }
      })
      const transaction = createDisposeTransaction({ kind: 'plan' }, { errorPolicy, report })

      const promise = transaction.run([
        { source: 'hostile', descriptor: hostile as IReleaseDescriptor },
        { source: 'later', descriptor: { force: laterForce } }
      ])
      if (errorPolicy === 'collect') {
        await expect(promise).resolves.toEqual([{ source: 'hostile', error: admissionError }])
      } else if (errorPolicy === 'report') {
        await expect(promise).resolves.toEqual([])
        expect(report).toHaveBeenCalledWith(admissionError)
      } else {
        await expect(promise).rejects.toBe(admissionError)
      }
      expect(laterForce).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['throw', 'collect', 'report', 'firstError'] as const)(
    'order mode excludes invalid order values, preserves numeric order, and follows %s policy',
    async (errorPolicy) => {
      const invalidForce = vi.fn()
      const calls: string[] = []
      const report = vi.fn()
      const invalid = { force: invalidForce, order: Number.NaN } as IReleaseDescriptor
      const transaction = createDisposeTransaction({ kind: 'order' }, { errorPolicy, report })

      const promise = transaction.run([
        { source: 'invalid', descriptor: invalid },
        {
          source: 'low',
          descriptor: {
            order: -1,
            force: () => {
              calls.push('low')
            }
          }
        },
        {
          source: 'high',
          descriptor: {
            order: 10,
            force: () => {
              calls.push('high')
            }
          }
        }
      ])
      if (errorPolicy === 'collect') {
        const result = await promise
        expect(result).toHaveLength(1)
        expect(result[0]?.source).toBe('invalid')
        expect(result[0]?.error).toMatchObject({ code: LifecycleErrorCode.invalidOption })
      } else if (errorPolicy === 'report') {
        await expect(promise).resolves.toEqual([])
        expect(report).toHaveBeenCalledWith(
          expect.objectContaining({ code: LifecycleErrorCode.invalidOption })
        )
      } else {
        await expect(promise).rejects.toMatchObject({ code: LifecycleErrorCode.invalidOption })
      }
      expect(invalidForce).not.toHaveBeenCalled()
      expect(calls).toEqual(['high', 'low'])
    }
  )

  it.each(['throw', 'collect', 'report', 'firstError'] as const)(
    'order getter failure follows %s policy without aborting later release',
    async (errorPolicy) => {
      const orderError = new Error('order getter failed')
      const invalidForce = vi.fn()
      const laterForce = vi.fn()
      const report = vi.fn()
      const hostile = { force: invalidForce } as Record<string, unknown>
      Object.defineProperty(hostile, 'order', {
        get: () => {
          throw orderError
        }
      })
      const transaction = createDisposeTransaction({ kind: 'order' }, { errorPolicy, report })

      const promise = transaction.run([
        { source: 'hostile', descriptor: hostile as IReleaseDescriptor },
        { source: 'later', descriptor: { order: 1, force: laterForce } }
      ])
      if (errorPolicy === 'collect') {
        await expect(promise).resolves.toEqual([{ source: 'hostile', error: orderError }])
      } else if (errorPolicy === 'report') {
        await expect(promise).resolves.toEqual([])
        expect(report).toHaveBeenCalledWith(orderError)
      } else {
        await expect(promise).rejects.toBe(orderError)
      }
      expect(invalidForce).not.toHaveBeenCalled()
      expect(laterForce).toHaveBeenCalledTimes(1)
    }
  )

  it('admission failures still drain pending work and finalize after all valid releases', async () => {
    const admissionError = new Error('custom getter failed')
    const laterForce = vi.fn()
    const drain = vi.fn(async () => undefined)
    const hostile = { force: vi.fn() } as Record<string, unknown>
    Object.defineProperty(hostile, 'custom', {
      get: () => {
        throw admissionError
      }
    })
    const transaction = createDisposeTransaction(
      { kind: 'order' },
      { errorPolicy: 'collect', pending: { drain } }
    )

    const result = await transaction.run([
      { source: 'hostile', descriptor: hostile as IReleaseDescriptor },
      { source: 'later', descriptor: { order: 1, force: laterForce } }
    ])

    expect(result).toEqual([{ source: 'hostile', error: admissionError }])
    expect(laterForce).toHaveBeenCalledTimes(1)
    expect(drain).toHaveBeenCalledTimes(1)
  })
})

describe('L-T55 Luna descriptor timeout admission', () => {
  it.each(['plan', 'order'] as const)(
    '%s mode rejects invalid gracefulTimeoutMs per policy',
    async (kind) => {
      for (const gracefulTimeoutMs of [Number.NaN, Number.POSITIVE_INFINITY, -1, '10'] as const) {
        for (const errorPolicy of ['throw', 'collect', 'report', 'firstError'] as const) {
          const graceful = vi.fn()
          const force = vi.fn()
          const laterForce = vi.fn()
          const report = vi.fn()
          const events: string[] = []
          const drain = vi.fn(async () => {
            events.push('drain')
          })
          const transaction = createDisposeTransaction(
            { kind },
            { errorPolicy, report, pending: { drain } }
          )
          const invalidDescriptor = {
            order: 100,
            graceful,
            gracefulTimeoutMs,
            force
          } as unknown as IReleaseDescriptor
          const promise = transaction.run([
            { source: 'invalid-timeout', descriptor: invalidDescriptor },
            {
              source: 'later',
              descriptor: {
                force: () => {
                  events.push('later-force')
                  laterForce()
                }
              }
            }
          ])

          let observedError: unknown

          if (errorPolicy === 'collect') {
            const result = await promise
            expect(result).toHaveLength(1)
            expect(result[0]).toMatchObject({
              source: 'invalid-timeout',
              error: {
                source: LIFECYCLE_SOURCE,
                code: LifecycleErrorCode.invalidOption
              }
            })
            observedError = result[0]?.error
            expect((observedError as { cause?: unknown }).cause).toBeUndefined()
          } else if (errorPolicy === 'report') {
            await expect(promise).resolves.toEqual([])
            expect(report).toHaveBeenCalledTimes(1)
            observedError = report.mock.calls[0]?.[0]
            expect(observedError).toMatchObject({
              source: LIFECYCLE_SOURCE,
              code: LifecycleErrorCode.invalidOption
            })
            expect((observedError as { cause?: unknown }).cause).toBeUndefined()
          } else {
            try {
              await promise
              expect.fail(`error policy ${errorPolicy} unexpectedly resolved`)
            } catch (error) {
              observedError = error
            }
            expect(observedError).toMatchObject({
              source: LIFECYCLE_SOURCE,
              code: LifecycleErrorCode.invalidOption
            })
            expect((observedError as { cause?: unknown }).cause).toBeUndefined()
          }

          expect(observedError).toBeInstanceOf(
            typeof gracefulTimeoutMs === 'number' ? RangeError : TypeError
          )

          expect(graceful).not.toHaveBeenCalled()
          expect(force).not.toHaveBeenCalled()
          expect(laterForce).toHaveBeenCalledTimes(1)
          expect(events).toEqual(['later-force', 'drain'])
          expect(drain).toHaveBeenCalledTimes(1)
        }
      }
    }
  )
})

describe('L-T32 DisposeTransaction: shared deadline across steps, not reset per step', () => {
  it('the same absolute deadlineAt value is handed to every item, unchanged', async () => {
    const deadlineAt = systemScheduler.now() + 50_000
    const observed: (number | undefined)[] = []
    const transaction = createDisposeTransaction(
      { kind: 'plan' },
      { errorPolicy: 'throw', deadlineAt }
    )
    await transaction.run([
      {
        source: 'a',
        descriptor: {
          force: async (c) => {
            observed.push(c.deadlineAt)
            await Promise.resolve()
          }
        }
      },
      {
        source: 'b',
        descriptor: {
          force: (c) => {
            observed.push(c.deadlineAt)
          }
        }
      },
      {
        source: 'c',
        descriptor: {
          force: (c) => {
            observed.push(c.deadlineAt)
          }
        }
      }
    ])
    expect(observed).toEqual([deadlineAt, deadlineAt, deadlineAt])
  })

  it("a graceful phase's own timeout is capped by whatever remains of the shared deadline", async () => {
    vi.useFakeTimers()
    try {
      const start = systemScheduler.now()
      const deadlineAt = start + 50 // very little budget remains
      const force = vi.fn()
      const graceful = () => new Promise<void>(() => {}) // never settles on its own
      const transaction = createDisposeTransaction(
        { kind: 'plan' },
        { errorPolicy: 'collect', deadlineAt }
      )
      const promise = transaction.run([
        { source: 'a', descriptor: { graceful, gracefulTimeoutMs: 10_000, force } }
      ])
      // Even though gracefulTimeoutMs asked for 10s, the shared deadline (50ms out) governs.
      await vi.advanceTimersByTimeAsync(60)
      await promise
      expect(force).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
