import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManualScheduler, systemScheduler } from '@migaia/utils/scheduler'
import { addSchedulerTime, resolveScheduler, snapshotScheduler } from '../src/scheduler.js'
import { boundedWait } from '../src/bounded-wait.js'
import { createLifecycleScope } from '../src/lifecycle-scope.js'
import { createDisposeTransaction } from '../src/dispose-transaction.js'
import { LifecycleErrorCode } from '../src/error-code.js'
import { createGenerationController } from '../src/generation-controller.js'
import { createMutationQueue } from '../src/mutation-queue.js'

/** Captures a synchronous throw for identity assertions. */
function captureThrow(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('T-16 lifecycle scheduler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('snapshot scheduler rejects invalid delay before injected schedule and preserves zero', () => {
    const schedule = vi.fn(() => ({ cancel: vi.fn() }))
    const snapshot = snapshotScheduler({ now: () => 0, schedule })
    expect(() => snapshot?.schedule(() => {}, NaN)).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.invalidOption })
    )
    expect(() => snapshot?.schedule(() => {}, -1)).toThrowError(RangeError)
    expect(schedule).not.toHaveBeenCalled()
    expect(() => snapshot?.schedule(() => {}, 0)).not.toThrow()
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('snapshot scheduler rejects non-number time values with native TypeError', () => {
    const schedule = vi.fn(() => ({ cancel: vi.fn() }))
    const snapshot = snapshotScheduler({ now: () => 0, schedule })
    expect(() => snapshot?.schedule(() => {}, '1' as never)).toThrowError(TypeError)
    expect(schedule).not.toHaveBeenCalled()
  })
})

describe('AF-T62 scheduler/task admission snapshot', () => {
  it('captures each scheduler accessor and each task cancel receiver exactly once', () => {
    let nowReads = 0
    let scheduleReads = 0
    let cancelReads = 0
    const task = {
      get cancel() {
        cancelReads++
        return function (this: unknown): void {
          expect(this).toBe(task)
        }
      }
    }
    const scheduler = {
      get now() {
        nowReads++
        return function (this: unknown): number {
          expect(this).toBe(scheduler)
          return 0
        }
      },
      get schedule() {
        scheduleReads++
        return function (this: unknown, callback: () => void): typeof task {
          expect(this).toBe(scheduler)
          callback()
          return task
        }
      }
    }

    const snapshot = snapshotScheduler(scheduler)
    expect(snapshot).toBeDefined()
    expect(snapshot?.now()).toBe(0)
    const returned = snapshot?.schedule(() => {}, 0)
    returned?.cancel()
    returned?.cancel()

    expect(nowReads).toBe(1)
    expect(scheduleReads).toBe(1)
    expect(cancelReads).toBe(1)
  })

  it('rejects a scheduler task without cancel at the scheduling boundary', () => {
    const snapshot = snapshotScheduler({
      now: () => 0,
      schedule: () => ({})
    })

    expect(() => snapshot?.schedule(() => {}, 0)).toThrowError(
      expect.objectContaining({ source: '@migaia/lifecycle', code: 'INVALID_OPTION' })
    )
  })

  it('public snapshotScheduler wraps hostile method getters once; resolveScheduler does not double-wrap', () => {
    const getterError = new Error('scheduler method getter failed')
    let reads = 0
    const scheduler = {
      get now() {
        reads++
        throw getterError
      },
      schedule: () => ({ cancel: () => {} })
    }

    let snapshotError: unknown
    try {
      snapshotScheduler(scheduler)
    } catch (error) {
      snapshotError = error
    }
    expect(snapshotError).toEqual(
      expect.objectContaining({
        source: '@migaia/lifecycle',
        code: LifecycleErrorCode.invalidOption,
        cause: getterError
      })
    )
    expect(reads).toBe(1)

    let resolvedError: unknown
    try {
      resolveScheduler(scheduler)
    } catch (error) {
      resolvedError = error
    }
    expect(resolvedError).toEqual(
      expect.objectContaining({
        source: '@migaia/lifecycle',
        code: LifecycleErrorCode.invalidOption,
        cause: getterError
      })
    )
    expect((resolvedError as Error).cause).toBe(getterError)
    expect((resolvedError as Error).cause).not.toHaveProperty('cause')
    expect(reads).toBe(2)
  })
})

describe('A5 injected task unref forwarding, rollback and lifecycle defaults', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Builds an injected scheduler whose single task exposes counting `cancel`/`unref` getters. */
  const injectedTask = (unrefValue: () => unknown, cancelImpl: () => void = () => undefined) => {
    /** Accessor reads in order. */
    const reads: string[] = []
    /** Cancel invocations with their receivers. */
    const cancelReceivers: unknown[] = []
    const task = {
      get cancel() {
        reads.push('cancel')
        return function (this: unknown) {
          cancelReceivers.push(this)
          cancelImpl()
        }
      },
      get unref() {
        reads.push('unref')
        return unrefValue()
      }
    }
    const scheduler = { now: () => 0, schedule: () => task }
    return { task, reads, cancelReceivers, scheduler }
  }

  it('forwards a function unref with the original task as receiver after reading cancel then unref once', () => {
    /** Receivers of the injected unref method. */
    const unrefReceivers: unknown[] = []
    const { task, reads, cancelReceivers, scheduler } = injectedTask(
      () =>
        function (this: unknown) {
          unrefReceivers.push(this)
        }
    )
    const snapshotTask = snapshotScheduler(scheduler)!.schedule(() => undefined, 1)
    snapshotTask.unref?.()
    snapshotTask.unref?.()
    expect(reads).toEqual(['cancel', 'unref'])
    expect(unrefReceivers).toEqual([task, task])
    expect(cancelReceivers).toEqual([])
  })

  it('rejects a non-function unref after cancelling the injected timer once', () => {
    const { cancelReceivers, task, scheduler } = injectedTask(() => 1)
    const error = captureThrow(() => snapshotScheduler(scheduler)!.schedule(() => undefined, 1))
    expect(error).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.invalidOption
    })
    expect(cancelReceivers).toEqual([task])
  })

  it('rejects a throwing unref getter with the original error on cause after one rollback', () => {
    const getterError = new Error('unref getter failed')
    const { cancelReceivers, scheduler } = injectedTask(() => {
      throw getterError
    })
    const error = captureThrow(() => snapshotScheduler(scheduler)!.schedule(() => undefined, 1))
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.invalidOption
    })
    expect((error as Error).cause).toBe(getterError)
    expect(cancelReceivers).toHaveLength(1)
  })

  it('keeps the unref rejection primary when the rollback cancel also throws', () => {
    const getterError = new Error('unref getter failed')
    const cancelError = new Error('cancel failed')
    const { scheduler } = injectedTask(
      () => {
        throw getterError
      },
      () => {
        throw cancelError
      }
    )
    const error = captureThrow(() => snapshotScheduler(scheduler)!.schedule(() => undefined, 1))
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).cause).toBe(getterError)
    expect((error as { errors?: unknown[] }).errors?.[0]).toBe(cancelError)
  })

  it('omits unref from the snapshot when the injected task has none, without cancelling', () => {
    const cancel = vi.fn()
    const snapshotTask = snapshotScheduler({
      now: () => 0,
      schedule: () => ({ cancel })
    })!.schedule(() => undefined, 1)
    expect(Object.hasOwn(snapshotTask, 'unref')).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('lifecycle factories default to a snapshot of the utils systemScheduler', async () => {
    const schedule = vi.spyOn(systemScheduler, 'schedule')
    const controller = createGenerationController()
    controller.begin({ timeoutMs: 5 })
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(schedule.mock.calls[0]![1]).toBe(5)
    controller.dispose()

    const now = vi.spyOn(systemScheduler, 'now')
    const queue = createMutationQueue()
    /** Releases the first queued task. */
    let release!: () => void
    const order: string[] = []
    const first = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push('t1')
            resolve()
          }
        })
    )
    expect(now).not.toHaveBeenCalled()
    const second = queue.enqueue(() => {
      order.push('t2')
    })
    expect(now).toHaveBeenCalled()
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['t1', 't2'])
  })
})

describe('A11 default scheduler identity versus lifecycle admission identity', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-1', -1]
  ] as const)('utils systemScheduler rejects delay %s with utils INVALID_ARGUMENT', (_l, delay) => {
    const error = captureThrow(() => systemScheduler.schedule(() => undefined, delay))
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ source: '@migaia/utils', code: 'INVALID_ARGUMENT' })
    expect((error as { detail?: unknown }).detail).toBeUndefined()
  })

  it('utils systemScheduler rejects a string delay with a utils TypeError', () => {
    const error = captureThrow(() => systemScheduler.schedule(() => undefined, '1' as never))
    expect(error).toBeInstanceOf(TypeError)
    expect(error).toMatchObject({ source: '@migaia/utils', code: 'INVALID_ARGUMENT' })
  })

  it('lifecycle admission rejects before reaching the utils implementation', () => {
    const schedule = vi.spyOn(systemScheduler, 'schedule')
    const error = captureThrow(() =>
      snapshotScheduler(systemScheduler)!.schedule(() => undefined, Number.NaN)
    )
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.invalidOption,
      detail: { field: 'delayMs' }
    })
    expect(schedule).not.toHaveBeenCalled()
  })

  it('createMutationQueue keeps lifecycle identity for an invalid default admission timeout', async () => {
    const queue = createMutationQueue({ queueAdmissionTimeoutMs: -1 })
    /** Releases the first queued task. */
    let release!: () => void
    const first = queue.enqueue(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('t1')
        })
    )
    const second = queue.enqueue(() => 't2')
    await expect(second).rejects.toBeInstanceOf(RangeError)
    await expect(second).rejects.toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.invalidOption,
      detail: { field: 'delayMs' }
    })
    expect(queue.size).toBe(1)
    release()
    await expect(first).resolves.toBe('t1')
  })
})

describe('A5 admission boundaries that replace the removed lifecycle implementation', () => {
  it('rejects overflowing admission arithmetic and non-scheduler values with lifecycle identity', () => {
    expect(
      captureThrow(() => addSchedulerTime(Number.MAX_VALUE, Number.MAX_VALUE, 'deadline'))
    ).toMatchObject({
      name: 'RangeError',
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.invalidOption,
      detail: { field: 'deadline' }
    })
    expect(snapshotScheduler(1)).toBeUndefined()
    expect(snapshotScheduler({ now: () => 0 })).toBeUndefined()
    expect(
      captureThrow(() => resolveScheduler({ schedule: () => ({ cancel() {} }) }))
    ).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.invalidOption
    })
    const primitiveTask = snapshotScheduler({ now: () => 0, schedule: () => 1 })!
    expect(captureThrow(() => primitiveTask.schedule(() => undefined, 1))).toMatchObject({
      source: '@migaia/lifecycle',
      code: LifecycleErrorCode.invalidOption
    })
  })

  it('boundedWait surfaces injected schedule and cancel failures unchanged', async () => {
    const scheduleFailure = new Error('schedule failed')
    await expect(
      boundedWait(new Promise(() => undefined), 10, {
        scheduler: {
          now: () => 0,
          schedule: () => {
            throw scheduleFailure
          }
        }
      })
    ).rejects.toBe(scheduleFailure)

    const cancelFailure = new Error('cancel failed')
    await expect(
      boundedWait(Promise.resolve('done'), 10, {
        scheduler: {
          now: () => 0,
          schedule: () => ({
            cancel: () => {
              throw cancelFailure
            }
          })
        }
      })
    ).rejects.toBe(cancelFailure)
  })

  it('drives a scope graceful deadline through an injected manual scheduler', async () => {
    const scheduler = createManualScheduler()
    const scope = createLifecycleScope({ scheduler })
    const force = vi.fn()
    scope.own(
      {},
      {
        graceful: () => new Promise<void>(() => undefined),
        gracefulTimeoutMs: 10,
        force
      }
    )
    const disposed = scope.dispose()
    for (let attempt = 0; attempt < 50 && scheduler.pendingCount === 0; attempt += 1)
      await Promise.resolve()
    expect(force).not.toHaveBeenCalled()
    scheduler.advance(10)
    await disposed
    expect(force).toHaveBeenCalledTimes(1)
  })

  it('drives a dispose transaction graceful deadline through an injected manual scheduler', async () => {
    const scheduler = createManualScheduler()
    const force = vi.fn()
    /** Abort listener the graceful callback registers on its release signal. */
    const listener = (): void => undefined
    const transaction = createDisposeTransaction({ kind: 'order' }, { scheduler })
    const run = transaction.run([
      {
        source: 'graceful-timeout',
        descriptor: {
          graceful: (context) => {
            context.signal.addEventListener('abort', listener)
            context.signal.removeEventListener('abort', listener)
            return new Promise<void>(() => undefined)
          },
          gracefulTimeoutMs: 10,
          force
        }
      }
    ])
    for (let attempt = 0; attempt < 50 && scheduler.pendingCount === 0; attempt += 1)
      await Promise.resolve()
    expect(force).not.toHaveBeenCalled()
    scheduler.advance(10)
    await run
    expect(force).toHaveBeenCalledTimes(1)
  })
})
