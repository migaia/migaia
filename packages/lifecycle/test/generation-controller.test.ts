import { describe, expect, it, vi } from 'vitest'
import {
  createGenerationController,
  type IGenerationControllerOptions
} from '../src/generation-controller.js'
import { LifecycleErrorCode } from '../src/error-code.js'

describe('L-T6 GenerationController: new generation, late arrival, disposed', () => {
  it('Round24 L-T60: invalid timeout preserves current generation state exactly', () => {
    const schedule = vi.fn(() => ({ cancel: vi.fn() }))
    const controller = createGenerationController({
      scheduler: { now: () => 0, schedule }
    })
    const current = controller.begin({ timeoutMs: 10 })
    const generation = controller.generation
    const token = current.token
    const signal = current.signal

    const invalidTimeouts: readonly unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      'not-a-number',
      true
    ]
    for (const timeoutMs of invalidTimeouts) {
      expect(() => controller.begin({ timeoutMs: timeoutMs as never })).toThrowError(
        expect.objectContaining({
          source: '@migaia/lifecycle',
          code: LifecycleErrorCode.invalidOption
        })
      )
      expect(controller.generation).toBe(generation)
      expect(controller.isCurrent(token)).toBe(true)
      expect(signal.aborted).toBe(false)
    }

    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('Round24 L-T60: timeout accessor is read before superseding current state', () => {
    const controller = createGenerationController({
      scheduler: { now: () => 0, schedule: () => ({ cancel: () => undefined }) }
    })
    const current = controller.begin()
    const cause = new Error('timeout getter failed')
    const options = {
      get timeoutMs(): number {
        throw cause
      }
    }

    expect(() => controller.begin(options)).toThrowError(
      expect.objectContaining({
        code: LifecycleErrorCode.invalidOption,
        cause
      })
    )
    expect(controller.generation).toBe(current.generation)
    expect(controller.isCurrent(current.token)).toBe(true)
    expect(current.signal.aborted).toBe(false)
  })

  it('rejects invalid timeoutMs before injected scheduler and retains no timer', () => {
    const schedule = vi.fn(() => ({ cancel: vi.fn() }))
    const controller = createGenerationController({ scheduler: { now: () => 0, schedule } })
    for (const timeoutMs of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() => controller.begin({ timeoutMs })).toThrowError(
        expect.objectContaining({ code: LifecycleErrorCode.invalidOption })
      )
    }
    expect(schedule).not.toHaveBeenCalled()
    expect(() => controller.begin({ timeoutMs: 0 })).not.toThrow()
  })
  it('AF-T62: snapshots scheduler methods once at controller construction', () => {
    let scheduleReads = 0
    let optionReads = 0
    const scheduler = {
      now: () => 0,
      get schedule() {
        scheduleReads++
        if (scheduleReads > 1) throw new Error('scheduler accessor was re-read')
        return () => ({ cancel: () => {} })
      }
    }
    const options = {
      get scheduler() {
        optionReads++
        return scheduler
      }
    }
    const controller = createGenerationController(options)

    controller.begin({ timeoutMs: 1 })
    controller.begin({ timeoutMs: 1 })

    expect(scheduleReads).toBe(1)
    expect(optionReads).toBe(1)
  })

  it('rolls back the generation and parent listener when scheduling the timeout throws', () => {
    const parent = new AbortController()
    const scheduler = {
      now: () => 0,
      schedule: () => {
        throw new Error('schedule boom')
      }
    }
    const controller = createGenerationController({ parentSignal: parent.signal, scheduler })
    expect(() => controller.begin({ timeoutMs: 1 })).toThrow('schedule boom')
    expect(controller.isCurrent({})).toBe(false)
    parent.abort()
    controller.dispose()
  })

  it('cancels a task returned after a synchronous scheduler callback', () => {
    let cancels = 0
    const controller = createGenerationController({
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          callback()
          return { cancel: () => cancels++ }
        }
      }
    })
    const request = controller.begin({ timeoutMs: 1 })
    expect(request.signal.aborted).toBe(true)
    expect(cancels).toBe(1)
  })

  it('a late (superseded) result cannot be adopted and is released instead', () => {
    const controller = createGenerationController()
    const first = controller.begin()
    controller.begin() // supersedes `first`
    const release = vi.fn()
    const accepted = controller.adopt(first.token, 'stale-value', release)
    expect(accepted).toBe(false)
    expect(release).toHaveBeenCalledWith('stale-value')
  })

  it('the current generation adopts successfully without releasing', () => {
    const controller = createGenerationController()
    const request = controller.begin()
    const release = vi.fn()
    const accepted = controller.adopt(request.token, 'value', release)
    expect(accepted).toBe(true)
    expect(release).not.toHaveBeenCalled()
  })

  it('a token from a disposed controller is never current and its result is released', () => {
    const controller = createGenerationController()
    const request = controller.begin()
    controller.dispose()
    const release = vi.fn()
    expect(controller.adopt(request.token, 'v', release)).toBe(false)
    expect(release).toHaveBeenCalled()
  })

  it('begin() throws GENERATION_DISPOSED on a disposed controller', () => {
    const controller = createGenerationController()
    controller.dispose()
    expect(() => controller.begin()).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.generationDisposed })
    )
  })

  it("begin()'s AbortSignal aborts when superseded by a later begin()", () => {
    const controller = createGenerationController()
    const first = controller.begin()
    expect(first.signal.aborted).toBe(false)
    controller.begin()
    expect(first.signal.aborted).toBe(true)
  })

  it('isCurrent() reflects only the most recent token', () => {
    const controller = createGenerationController()
    const first = controller.begin()
    expect(controller.isCurrent(first.token)).toBe(true)
    const second = controller.begin()
    expect(controller.isCurrent(first.token)).toBe(false)
    expect(controller.isCurrent(second.token)).toBe(true)
  })

  it('an unrelated foreign token is never current', () => {
    const controller = createGenerationController()
    controller.begin()
    expect(controller.isCurrent({})).toBe(false)
  })

  it('begin({ timeoutMs }) auto-aborts the returned signal after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const controller = createGenerationController()
      const request = controller.begin({ timeoutMs: 100 })
      expect(request.signal.aborted).toBe(false)
      vi.advanceTimersByTime(101)
      expect(request.signal.aborted).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('L-T30 GenerationController: old generation cleanup failure does not poison new generation', () => {
  it('a release failure for a superseded token leaves the new generation state untouched', () => {
    const controller = createGenerationController()
    const stale = controller.begin()
    const fresh = controller.begin()
    const onReleaseError = vi.fn()
    const release = () => {
      throw new Error('cleanup failed')
    }
    const accepted = controller.adopt(stale.token, 'v', release, onReleaseError)
    expect(accepted).toBe(false)
    expect(onReleaseError).toHaveBeenCalledTimes(1)
    // The new generation is unaffected: it can still adopt normally.
    expect(controller.isCurrent(fresh.token)).toBe(true)
    const freshRelease = vi.fn()
    expect(controller.adopt(fresh.token, 'fresh-value', freshRelease)).toBe(true)
    expect(freshRelease).not.toHaveBeenCalled()
  })

  it('an async release rejection for a superseded token is observed without becoming an unhandled rejection', async () => {
    const controller = createGenerationController()
    const stale = controller.begin()
    controller.begin()
    const onReleaseError = vi.fn()
    controller.adopt(
      stale.token,
      'v',
      () => Promise.reject(new Error('async cleanup failed')),
      onReleaseError
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(onReleaseError).toHaveBeenCalledTimes(1)
    expect((onReleaseError.mock.calls[0]![0] as Error).message).toBe('async cleanup failed')
  })

  it('a throwing onReleaseError callback does not propagate out of adopt()', () => {
    const controller = createGenerationController()
    const stale = controller.begin()
    controller.begin()
    expect(() =>
      controller.adopt(
        stale.token,
        'v',
        () => {
          throw new Error('cleanup failed')
        },
        () => {
          throw new Error('reporter also failed')
        }
      )
    ).not.toThrow()
  })
})

describe('AF-T73 GenerationController cancellation cleanup boundary', () => {
  it('single cleanup Error keeps identity and receives GENERATION_CANCELLATION_FAILED', () => {
    const cleanupError = new Error('timer cleanup failed')
    const controller = createGenerationController({
      scheduler: {
        now: () => 0,
        schedule: () => ({
          cancel: () => {
            throw cleanupError
          }
        })
      }
    })
    controller.begin({ timeoutMs: 1 })

    let caught: unknown
    try {
      controller.supersede('test cancellation')
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(cleanupError)
    expect(cleanupError).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.generationCancellationFailed
    })
  })

  it('multiple cleanup failures preserve identity and cleanup order under GENERATION_CANCELLATION_FAILED', () => {
    const timerError = new Error('timer cleanup failed')
    const parentError = new Error('parent listener cleanup failed')
    const parent: IGenerationControllerOptions['parentSignal'] = {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {
        throw parentError
      }
    }
    const controller = createGenerationController({
      parentSignal: parent,
      scheduler: {
        now: () => 0,
        schedule: () => ({
          cancel: () => {
            throw timerError
          }
        })
      }
    })
    controller.begin({ timeoutMs: 1 })

    let caught: unknown
    try {
      controller.supersede('test cancellation')
    } catch (error) {
      caught = error
    }

    expect(caught).toEqual(
      expect.objectContaining({
        source: '@migaia/lifecycle',
        code: LifecycleErrorCode.generationCancellationFailed
      })
    )
    expect((caught as AggregateError).errors).toEqual([timerError, parentError])
  })

  it('single primitive cleanup failure is wrapped with cause', () => {
    const controller = createGenerationController({
      scheduler: {
        now: () => 0,
        schedule: () => ({
          cancel: () => {
            throw 'primitive cleanup failure'
          }
        })
      }
    })
    controller.begin({ timeoutMs: 1 })

    let caught: unknown
    try {
      controller.supersede()
    } catch (error) {
      caught = error
    }

    expect(caught).toEqual(
      expect.objectContaining({
        source: '@migaia/lifecycle',
        code: LifecycleErrorCode.generationCancellationFailed,
        cause: 'primitive cleanup failure'
      })
    )
  })
})

describe('L-T31 GenerationController: parent closing', () => {
  it("auto-aborts the current generation's signal when the parent signal aborts", () => {
    const parent = new AbortController()
    const controller = createGenerationController({ parentSignal: parent.signal })
    const request = controller.begin()
    expect(request.signal.aborted).toBe(false)
    parent.abort('parent closing')
    expect(request.signal.aborted).toBe(true)
  })

  it('a controller created with an already-aborted parent signal starts every generation pre-aborted', () => {
    const parent = new AbortController()
    parent.abort('already closed')
    const controller = createGenerationController({ parentSignal: parent.signal })
    const request = controller.begin()
    expect(request.signal.aborted).toBe(true)
  })

  it("the parent's abort does not throw or reject anything by itself — it only changes signal state", () => {
    const parent = new AbortController()
    const controller = createGenerationController({ parentSignal: parent.signal })
    controller.begin()
    expect(() => parent.abort('closing')).not.toThrow()
  })
})

describe('AF-T74 GenerationController parent admission races', () => {
  it('rolls back a failed parent listener registration and keeps primary plus cleanup identity', () => {
    const primaryError = new Error('parent registration failed')
    const cleanupError = new Error('parent listener removal failed')
    let removeCalls = 0
    const parent: IGenerationControllerOptions['parentSignal'] = {
      aborted: false,
      addEventListener: () => {
        throw primaryError
      },
      removeEventListener: () => {
        removeCalls++
        throw cleanupError
      }
    }
    const controller = createGenerationController({ parentSignal: parent })

    let caught: unknown
    try {
      controller.begin()
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(primaryError)
    expect(caught).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.generationCancellationFailed,
      errors: [cleanupError]
    })
    expect(removeCalls).toBe(1)
    expect(controller.isCurrent({})).toBe(false)
  })

  it('rechecks synchronous parent abort and removes a listener installed after its callback', () => {
    let aborted = false
    const listeners = new Set<() => void>()
    let removeCalls = 0
    const parent: IGenerationControllerOptions['parentSignal'] = {
      get aborted() {
        return aborted
      },
      reason: 'synchronous parent abort',
      addEventListener: (_type, listener) => {
        aborted = true
        listener()
        // Hostile registration installs the listener after synchronously firing it.
        listeners.add(listener)
      },
      removeEventListener: (_type, listener) => {
        removeCalls++
        listeners.delete(listener)
      }
    }
    let scheduleCalls = 0
    const controller = createGenerationController({
      parentSignal: parent,
      scheduler: {
        now: () => 0,
        schedule: () => {
          scheduleCalls++
          return { cancel: () => {} }
        }
      }
    })

    const request = controller.begin({ timeoutMs: 10 })

    expect(request.signal.aborted).toBe(true)
    expect(controller.isCurrent(request.token)).toBe(false)
    expect(listeners.size).toBe(0)
    expect(removeCalls).toBe(2)
    expect(scheduleCalls).toBe(0)
  })

  it('keeps a parent reason getter failure as the tagged primary while rolling back residual registration', () => {
    const reasonError = new Error('parent reason getter failed')
    let aborted = false
    const listeners = new Set<() => void>()
    const parent: IGenerationControllerOptions['parentSignal'] = {
      get aborted() {
        return aborted
      },
      get reason() {
        throw reasonError
      },
      addEventListener: (_type, listener) => {
        aborted = true
        try {
          listener()
        } finally {
          listeners.add(listener)
        }
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener)
      }
    }
    const controller = createGenerationController({ parentSignal: parent })

    let caught: unknown
    try {
      controller.begin()
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(reasonError)
    expect(caught).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.generationCancellationFailed
    })
    expect(listeners.size).toBe(0)
    expect(controller.isCurrent({})).toBe(false)
  })
})

describe('Round25 L-T61 synchronous scheduler callback cleanup boundary', () => {
  it('captures parent cleanup failure until task acquisition, cancels once, and removes residual listener', () => {
    const primaryError = new Error('parent cleanup failed')
    const listeners = new Set<() => void>()
    let removeCalls = 0
    let cancelCalls = 0
    const parent: IGenerationControllerOptions['parentSignal'] = {
      aborted: false,
      addEventListener: (_type, listener) => {
        listeners.add(listener)
      },
      removeEventListener: (_type, listener) => {
        removeCalls++
        if (removeCalls === 1) throw primaryError
        listeners.delete(listener)
      }
    }
    const controller = createGenerationController({
      parentSignal: parent,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          callback()
          return { cancel: () => cancelCalls++ }
        }
      }
    })

    let caught: unknown
    try {
      controller.begin({ timeoutMs: 1 })
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(primaryError)
    expect(primaryError).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.generationCancellationFailed
    })
    expect(cancelCalls).toBe(1)
    expect(removeCalls).toBe(2)
    expect(listeners).toHaveLength(0)
    expect(controller.generation).toBe(1)
    expect(controller.isCurrent({})).toBe(false)
  })

  it('keeps callback primary before task cancel and parent retry cleanup failures', () => {
    const primaryError = new Error('parent cleanup failed')
    const cancelError = new Error('returned task cancel failed')
    const retryError = new Error('parent cleanup retry failed')
    let removeCalls = 0
    let cancelCalls = 0
    const parent: IGenerationControllerOptions['parentSignal'] = {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {
        removeCalls++
        throw removeCalls === 1 ? primaryError : retryError
      }
    }
    const controller = createGenerationController({
      parentSignal: parent,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          callback()
          return {
            cancel: () => {
              cancelCalls++
              throw cancelError
            }
          }
        }
      }
    })

    let caught: unknown
    try {
      controller.begin({ timeoutMs: 1 })
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(primaryError)
    expect((caught as { errors?: readonly unknown[] }).errors).toEqual([cancelError, retryError])
    expect(cancelCalls).toBe(1)
    expect(removeCalls).toBe(2)
    expect(controller.generation).toBe(1)
    expect(controller.isCurrent({})).toBe(false)
  })

  it('retains callback primary when task cancel getter fails after synchronous callback', () => {
    const primaryError = new Error('parent cleanup failed')
    const cancelGetterError = new Error('cancel getter failed')
    let cancelReads = 0
    let removeCalls = 0
    const parent: IGenerationControllerOptions['parentSignal'] = {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {
        removeCalls++
        if (removeCalls === 1) throw primaryError
      }
    }
    const task = {
      get cancel(): () => void {
        cancelReads++
        throw cancelGetterError
      }
    }
    const controller = createGenerationController({
      parentSignal: parent,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          callback()
          return task
        }
      }
    })

    let caught: unknown
    try {
      controller.begin({ timeoutMs: 1 })
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(primaryError)
    expect((caught as { errors?: readonly unknown[] }).errors).toHaveLength(1)
    expect(
      ((caught as { errors: readonly [{ cause?: unknown }] }).errors[0] as { cause?: unknown })
        .cause
    ).toBe(cancelGetterError)
    expect(cancelReads).toBe(1)
    expect(removeCalls).toBe(2)
    expect(controller.generation).toBe(1)
    expect(controller.isCurrent({})).toBe(false)
  })

  it('does not invent a cancel attempt when schedule throws before returning a task', () => {
    const primaryError = new Error('parent cleanup failed')
    const scheduleError = new Error('schedule failed before return')
    let cancelCalls = 0
    let removeCalls = 0
    const parent: IGenerationControllerOptions['parentSignal'] = {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {
        removeCalls++
        if (removeCalls === 1) throw primaryError
      }
    }
    const controller = createGenerationController({
      parentSignal: parent,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          callback()
          throw scheduleError
        }
      }
    })

    let caught: unknown
    try {
      controller.begin({ timeoutMs: 1 })
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(primaryError)
    expect((caught as { errors?: readonly unknown[] }).errors).toEqual([scheduleError])
    expect(cancelCalls).toBe(0)
    expect(removeCalls).toBe(2)
    expect(controller.generation).toBe(1)
    expect(controller.isCurrent({})).toBe(false)
  })
})
