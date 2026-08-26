import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createManualScheduler,
  resolveScheduler,
  snapshotScheduler,
  systemScheduler,
  type ILifecycleScheduler
} from '../src/scheduler.js'
import { LifecycleErrorCode } from '../src/error-code.js'

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

  it('manualScheduler.now() 单调不递减，相同值合法', () => {
    const scheduler = createManualScheduler()
    expect(scheduler.now()).toBe(0)
    scheduler.advance(5)
    expect(scheduler.now()).toBe(5)
    scheduler.advance(0)
    expect(scheduler.now()).toBe(5)
  })

  it('manualScheduler.schedule 到期才执行，callback 至多一次', () => {
    const scheduler = createManualScheduler()
    let count = 0
    scheduler.schedule(() => {
      count++
    }, 10)
    expect(count).toBe(0)
    scheduler.advance(9)
    expect(count).toBe(0)
    scheduler.advance(1)
    expect(count).toBe(1)
    scheduler.advance(100)
    expect(count).toBe(1)
  })

  it('manualScheduler.cancel 幂等，cancel 后不执行', () => {
    const scheduler = createManualScheduler()
    let count = 0
    const task = scheduler.schedule(() => {
      count++
    }, 10)
    task.cancel()
    task.cancel()
    scheduler.advance(100)
    expect(count).toBe(0)
  })

  it('manualScheduler 按到期时刻升序执行（同时刻按登记顺序）', () => {
    const scheduler = createManualScheduler()
    const order: number[] = []
    scheduler.schedule(() => order.push(2), 20)
    scheduler.schedule(() => order.push(1), 10)
    scheduler.schedule(() => order.push(3), 10)
    scheduler.advance(30)
    expect(order).toEqual([1, 3, 2])
  })

  it('manualScheduler rejects schedule overflow before task insertion and callback', () => {
    const scheduler = createManualScheduler()
    let retainedRuns = 0
    let overflowRuns = 0

    scheduler.advance(Number.MAX_VALUE)
    scheduler.schedule(() => {
      retainedRuns++
    }, 0)

    expect(() =>
      scheduler.schedule(() => {
        overflowRuns++
      }, Number.MAX_VALUE)
    ).toThrowError(
      expect.objectContaining({
        name: 'RangeError',
        code: LifecycleErrorCode.invalidOption
      })
    )
    expect(scheduler.now()).toBe(Number.MAX_VALUE)
    expect(overflowRuns).toBe(0)

    scheduler.advance(0)
    expect(retainedRuns).toBe(1)
    expect(overflowRuns).toBe(0)
  })

  it('manualScheduler rejects advance overflow before clock or queue mutation', () => {
    const scheduler = createManualScheduler()
    let runs = 0

    scheduler.advance(Number.MAX_VALUE)
    scheduler.schedule(() => {
      runs++
    }, 0)

    expect(() => scheduler.advance(Number.MAX_VALUE)).toThrowError(
      expect.objectContaining({
        name: 'RangeError',
        code: LifecycleErrorCode.invalidOption
      })
    )
    expect(scheduler.now()).toBe(Number.MAX_VALUE)
    expect(runs).toBe(0)

    scheduler.advance(0)
    expect(runs).toBe(1)
  })

  it('manualScheduler preserves finite maximum and zero arithmetic edges', () => {
    const scheduler = createManualScheduler()
    let runs = 0

    scheduler.advance(Number.MAX_VALUE)
    scheduler.schedule(() => {
      runs++
    }, 0)
    scheduler.advance(0)

    expect(scheduler.now()).toBe(Number.MAX_VALUE)
    expect(runs).toBe(1)
  })

  it('systemScheduler.now() 返回有限数字（performance.now）', () => {
    expect(Number.isFinite(systemScheduler.now())).toBe(true)
  })

  it.each([
    ['NaN', NaN, RangeError],
    ['Infinity', Infinity, RangeError],
    ['-Infinity', -Infinity, RangeError],
    ['non-number', 'clock', TypeError]
  ] as const)(
    'systemScheduler.now() rejects %s clock values without timer effects',
    async (_label, value, errorType) => {
      const timer = vi.fn(() => 1)
      const clear = vi.fn()
      const performanceHost = {
        now(this: unknown) {
          expect(this).toBe(performanceHost)
          return value
        }
      }
      vi.stubGlobal('performance', performanceHost)
      vi.stubGlobal('setTimeout', timer)
      vi.stubGlobal('clearTimeout', clear)
      vi.resetModules()
      const isolatedScheduler = (await import('../src/scheduler.js')).systemScheduler

      expect(() => isolatedScheduler.now()).toThrowError(
        expect.objectContaining({
          name: errorType.name,
          source: '@migaia/lifecycle',
          code: LifecycleErrorCode.invalidOption
        })
      )
      expect(timer).not.toHaveBeenCalled()
      expect(clear).not.toHaveBeenCalled()
    }
  )

  it('systemScheduler.now() preserves finite zero and original performance.now throws', async () => {
    const originalError = new Error('clock failed')
    let clockValue: number | (() => never) = 0
    vi.stubGlobal('performance', {
      now() {
        if (typeof clockValue === 'function') return clockValue()
        return clockValue
      }
    })
    vi.resetModules()
    const isolatedScheduler = (await import('../src/scheduler.js')).systemScheduler

    expect(isolatedScheduler.now()).toBe(0)
    clockValue = () => {
      throw originalError
    }
    expect(() => isolatedScheduler.now()).toThrow(originalError)
  })

  it('systemScheduler.schedule 创建真实 timer，cancel 幂等后不执行', async () => {
    let count = 0
    const task = systemScheduler.schedule(() => {
      count++
    }, 1)
    task.cancel()
    task.cancel()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(count).toBe(0)
  })

  it('performance.now 缺失 → now() 抛 ENV_UNSUPPORTED', () => {
    vi.stubGlobal('performance', undefined)
    expect(() => systemScheduler.now()).toThrowError(
      expect.objectContaining({ code: 'ENV_UNSUPPORTED', source: '@migaia/lifecycle' })
    )
  })

  it('setTimeout/clearTimeout 缺失 → schedule() 抛 ENV_UNSUPPORTED', () => {
    vi.stubGlobal('setTimeout', undefined)
    vi.stubGlobal('clearTimeout', undefined)
    expect(() => systemScheduler.schedule(() => {}, 1)).toThrowError(
      expect.objectContaining({ code: 'ENV_UNSUPPORTED', source: '@migaia/lifecycle' })
    )
  })
})

describe('T-18 scheduler contract 兼容门禁', () => {
  it('ILifecycleScheduler 可赋值给 ISerializeScheduler 结构子集（compile-time）', () => {
    // serialize/core 将自声明的结构子集（R-4）；lifecycle 不得多出 serialize 未定义的语义。
    type ISerializeScheduler = {
      now(): number
      schedule(callback: () => void, delayMs: number): { cancel(): void }
    }
    const scheduler: ILifecycleScheduler = createManualScheduler()
    const asSerialize: ISerializeScheduler = scheduler
    expect(asSerialize).toBe(scheduler)
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
