import { describe, expect, it, vi } from 'vitest'
import { sliceByFrameBudget } from '../src/index.ts'

import { rows, observeYieldResult, type ITestAbortSignal } from './fixtures/stream.ts'

describe('sliceByFrameBudget：按实测耗时定片大小', () => {
  it('owns scheduler getter and clock failures at the serialize core boundary', async () => {
    const getterFailure = new Error('now getter failed')
    const getterScheduler = {
      get now(): () => number {
        throw getterFailure
      },
      schedule: () => ({ cancel() {} })
    }
    const callFailure = new Error('now call failed')
    const callScheduler = {
      now: () => {
        throw callFailure
      },
      schedule: () => ({ cancel() {} })
    }

    for (const schedulerOption of [getterScheduler, callScheduler]) {
      const error = await sliceByFrameBudget(rows(1), {
        scheduler: schedulerOption
      })
        .next()
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: 'serialization',
        code: 'INVALID_OPTION',
        cause: schedulerOption === getterScheduler ? getterFailure : callFailure,
        message:
          schedulerOption === getterScheduler
            ? 'serialize scheduler accessor could not be read'
            : 'serialize scheduler now() must return a number'
      })
    }
  })

  it('owns non-finite scheduler clock values with native RangeError semantics', async () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const error = await sliceByFrameBudget(rows(1), {
        scheduler: { now: () => value, schedule: () => ({ cancel() {} }) }
      })
        .next()
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(RangeError)
      expect(error).toMatchObject({
        source: 'serialization',
        code: 'INVALID_OPTION',
        message: 'serialize scheduler now() must return a finite number'
      })
    }
  })

  it('owns scheduler schedule and task cancel-accessor failures with causes', async () => {
    const scheduleFailure = new Error('schedule failed')
    const scheduleThrowing = {
      now: () => 0,
      schedule: () => {
        throw scheduleFailure
      }
    }
    const cancelGetterFailure = new Error('cancel getter failed')
    const cancelGetterThrowing = {
      now: () => 0,
      schedule: () => ({
        get cancel(): () => void {
          throw cancelGetterFailure
        }
      })
    }

    for (const schedulerOption of [scheduleThrowing, cancelGetterThrowing]) {
      const iterator = sliceByFrameBudget(rows(2), {
        initialItems: 1,
        minItems: 1,
        maxItems: 1,
        scheduler: schedulerOption
      })
      await iterator.next()
      const error = await iterator.next().catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: 'serialization',
        code: 'INVALID_OPTION',
        cause: schedulerOption === scheduleThrowing ? scheduleFailure : cancelGetterFailure,
        message:
          schedulerOption === scheduleThrowing
            ? 'serialize scheduler must be { now, schedule }'
            : 'serialize scheduler task cancel accessor could not be read'
      })
    }
  })

  it('retains the default-yield task and cancels it once after asynchronous callback settlement', async () => {
    let runCallback: (() => void) | undefined
    const cancel = vi.fn()
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          runCallback = callback
          return { cancel }
        }
      }
    })

    await expect(iterator.next()).resolves.toMatchObject({ value: [{ id: 0 }], done: false })
    const next = iterator.next()
    await Promise.resolve()
    expect(cancel).not.toHaveBeenCalled()
    runCallback?.()
    await expect(next).resolves.toMatchObject({ value: [{ id: 1 }], done: false })
    expect(cancel).toHaveBeenCalledTimes(1)
    await iterator.return(undefined)
  })

  it('cancels a task returned after a synchronous default-yield callback', async () => {
    const cancel = vi.fn()
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          callback()
          return { cancel }
        }
      }
    })

    await iterator.next()
    await expect(iterator.next()).resolves.toMatchObject({ value: [{ id: 1 }], done: false })
    expect(cancel).toHaveBeenCalledTimes(1)
    await iterator.return(undefined)
  })

  it('settles default yield on abort and preserves cancel failure as secondary', async () => {
    const controller = new AbortController()
    const cancelFailure = new Error('yield cancel failed')
    let runCallback: (() => void) | undefined
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      signal: controller.signal,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          runCallback = callback
          return {
            cancel: () => {
              throw cancelFailure
            }
          }
        }
      }
    })

    await iterator.next()
    const next = iterator.next()
    await Promise.resolve()
    controller.abort('stream disposed')
    const error = await next.catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      source: 'serialization',
      code: 'ABORTED',
      cause: 'stream disposed',
      errors: [
        expect.objectContaining({
          source: 'serialization',
          code: 'INVALID_OPTION',
          cause: cancelFailure
        })
      ]
    })
    expect(cancelFailure).not.toBe(error)
    runCallback?.()
  })

  it('translates default-yield cancel failure to serialize INVALID_OPTION', async () => {
    const cancelFailure = new Error('cancel failed')
    let runCallback: (() => void) | undefined
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      scheduler: {
        now: () => 0,
        schedule: (callback) => {
          runCallback = callback
          return {
            cancel: () => {
              throw cancelFailure
            }
          }
        }
      }
    })

    await iterator.next()
    const next = iterator.next()
    await Promise.resolve()
    runCallback?.()
    await expect(next).rejects.toMatchObject({
      source: 'serialization',
      code: 'INVALID_OPTION',
      cause: cancelFailure,
      message: 'serialize scheduler task cancel() failed'
    })
  })

  it.each(['stored-then-abort', 'abort-then-store'] as const)(
    'rechecks a signal that aborts synchronously during %s registration without scheduling',
    async (registrationOrder) => {
      const reason = `${registrationOrder} reason`
      let aborted = false
      let storedListener: (() => void) | undefined
      let removeCalls = 0
      let scheduleCalls = 0
      const signal: ITestAbortSignal = {
        get aborted() {
          return aborted
        },
        get reason() {
          return reason
        },
        addEventListener(_type, listener) {
          if (registrationOrder === 'abort-then-store') aborted = true
          storedListener = listener
          if (registrationOrder === 'stored-then-abort') aborted = true
        },
        removeEventListener(_type, listener) {
          removeCalls++
          expect(listener).toBe(storedListener)
        }
      }
      const iterator = sliceByFrameBudget(rows(2), {
        initialItems: 1,
        minItems: 1,
        maxItems: 1,
        signal,
        scheduler: {
          now: () => 0,
          schedule: () => {
            scheduleCalls++
            return { cancel: vi.fn() }
          }
        }
      })

      await iterator.next()
      const error = await observeYieldResult(iterator.next())
      expect(error).toMatchObject({
        source: 'serialization',
        code: 'ABORTED',
        cause: reason
      })
      expect(scheduleCalls).toBe(0)
      expect(removeCalls).toBe(1)
      expect(storedListener).toBeDefined()
    }
  )

  it('preserves stored-then-throw registration failure and listener cleanup failure', async () => {
    const registrationFailure = new Error('registration failed')
    const removeFailure = new Error('remove failed')
    let storedListener: (() => void) | undefined
    let removeCalls = 0
    let scheduleCalls = 0
    const signal: ITestAbortSignal = {
      aborted: false,
      reason: 'unused',
      addEventListener(_type, listener) {
        storedListener = listener
        throw registrationFailure
      },
      removeEventListener(_type, listener) {
        removeCalls++
        expect(listener).toBe(storedListener)
        throw removeFailure
      }
    }
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      signal,
      scheduler: {
        now: () => 0,
        schedule: () => {
          scheduleCalls++
          return { cancel: vi.fn() }
        }
      }
    })

    await iterator.next()
    const error = await observeYieldResult(iterator.next())
    expect(error).toMatchObject({
      source: 'serialization',
      code: 'INVALID_OPTION',
      message: 'serialize abort signal listener registration failed',
      cause: registrationFailure,
      errors: [
        expect.objectContaining({
          source: 'serialization',
          code: 'INVALID_OPTION',
          cause: removeFailure
        })
      ]
    })
    expect(scheduleCalls).toBe(0)
    expect(removeCalls).toBe(1)
  })

  it.each([false, true] as const)(
    'keeps registration primary when addEventListener invokes abort before it %s',
    async (throwsAfterCallback) => {
      const registrationFailure = new Error('registration failed after callback')
      const reason = 'callback reason'
      let storedListener: (() => void) | undefined
      let removeCalls = 0
      let scheduleCalls = 0
      const signal: ITestAbortSignal = {
        get aborted() {
          return storedListener !== undefined
        },
        reason,
        addEventListener(_type, listener) {
          storedListener = listener
          listener()
          if (throwsAfterCallback) throw registrationFailure
        },
        removeEventListener(_type, listener) {
          removeCalls++
          expect(listener).toBe(storedListener)
        }
      }
      const iterator = sliceByFrameBudget(rows(2), {
        initialItems: 1,
        minItems: 1,
        maxItems: 1,
        signal,
        scheduler: {
          now: () => 0,
          schedule: () => {
            scheduleCalls++
            return { cancel: vi.fn() }
          }
        }
      })

      await iterator.next()
      const error = await observeYieldResult(iterator.next())
      if (throwsAfterCallback) {
        expect(error).toMatchObject({
          source: 'serialization',
          code: 'INVALID_OPTION',
          message: 'serialize abort signal listener registration failed',
          cause: registrationFailure
        })
      } else {
        expect(error).toMatchObject({
          source: 'serialization',
          code: 'ABORTED',
          cause: reason
        })
      }
      expect(scheduleCalls).toBe(0)
      expect(removeCalls).toBe(1)
    }
  )

  it('preserves abort primary when partial-registration listener removal fails', async () => {
    const removeFailure = new Error('abort listener remove failed')
    const reason = 'partial registration abort'
    let storedListener: (() => void) | undefined
    let aborted = false
    let removeCalls = 0
    const signal: ITestAbortSignal = {
      get aborted() {
        return aborted
      },
      reason,
      addEventListener(_type, listener) {
        storedListener = listener
        aborted = true
      },
      removeEventListener(_type, listener) {
        removeCalls++
        expect(listener).toBe(storedListener)
        throw removeFailure
      }
    }
    const iterator = sliceByFrameBudget(rows(2), {
      initialItems: 1,
      minItems: 1,
      maxItems: 1,
      signal,
      scheduler: {
        now: () => 0,
        schedule: () => {
          throw new Error('schedule must not run')
        }
      }
    })

    await iterator.next()
    const error = await observeYieldResult(iterator.next())
    expect(error).toMatchObject({
      source: 'serialization',
      code: 'ABORTED',
      cause: reason,
      errors: [
        expect.objectContaining({
          source: 'serialization',
          code: 'INVALID_OPTION',
          cause: removeFailure
        })
      ]
    })
    expect(removeCalls).toBe(1)
  })
})
