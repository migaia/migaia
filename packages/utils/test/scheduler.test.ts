import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createManualScheduler,
  systemScheduler,
  systemWallClock,
  type IScheduler
} from '../src/scheduler.js'

/** Largest delay one host timer segment may carry. */
const MAXIMUM_TIMER_DELAY = 2_147_483_647

/** One native-like timer handle recorded by the stubbed host. */
type IRecordedTimer = {
  readonly callback: () => void
  readonly delayMs: number
  readonly unref: ReturnType<typeof vi.fn>
  readonly receivers: unknown[]
}

/**
 * Installs recording `setTimeout`/`clearTimeout` stubs whose handles expose an `unref` method that
 * records its receiver, so segment-level unref behaviour can be asserted without real timers.
 */
function stubRecordingTimers() {
  /** Every handle returned by the stubbed `setTimeout`, in creation order. */
  const timers: IRecordedTimer[] = []
  /** Stubbed registration function. */
  const set = vi.fn((callback: () => void, delayMs: number) => {
    /** Receivers observed by this handle's `unref`. */
    const receivers: unknown[] = []
    /** Handle whose `unref` records the receiver it was called on. */
    const timer: IRecordedTimer = {
      callback,
      delayMs,
      receivers,
      unref: vi.fn(function (this: unknown) {
        receivers.push(this)
      })
    }
    timers.push(timer)
    return timer
  })
  /** Stubbed cancellation function. */
  const clear = vi.fn()
  vi.stubGlobal('setTimeout', set)
  vi.stubGlobal('clearTimeout', clear)
  return { timers, set, clear }
}

/** Reloads the scheduler module so the default implementation is observed after global stubs. */
async function reloadedSystemScheduler(): Promise<IScheduler> {
  vi.resetModules()
  return (await import('../src/scheduler.js')).systemScheduler
}

/** Captures a synchronous throw for identity assertions. */
function captureThrow(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('A2 systemScheduler monotonic clock and host capability failures', () => {
  it('reads performance.now with its host receiver instead of Date.now', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    /** Stubbed performance host that asserts its receiver. */
    const performanceHost = {
      now: vi.fn(function (this: unknown) {
        expect(this).toBe(performanceHost)
        return 5
      })
    }
    vi.stubGlobal('performance', performanceHost)
    const scheduler = await reloadedSystemScheduler()
    expect(scheduler.now()).toBe(5)
    expect(performanceHost.now).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['NaN', Number.NaN, RangeError],
    ['Infinity', Number.POSITIVE_INFINITY, RangeError],
    ['-Infinity', Number.NEGATIVE_INFINITY, RangeError],
    ['non-number', 'clock', TypeError]
  ] as const)(
    'systemScheduler.now() rejects %s clock values without timer effects',
    async (_label, value, errorType) => {
      const { set, clear } = stubRecordingTimers()
      /** Stubbed performance host returning the invalid reading. */
      const performanceHost = {
        now(this: unknown) {
          expect(this).toBe(performanceHost)
          return value
        }
      }
      vi.stubGlobal('performance', performanceHost)
      const scheduler = await reloadedSystemScheduler()
      const error = captureThrow(() => scheduler.now())
      expect(error).toBeInstanceOf(errorType)
      expect(error).toMatchObject({ source: '@migaia/utils', code: 'ENV_UNSUPPORTED' })
      expect(set).not.toHaveBeenCalled()
      expect(clear).not.toHaveBeenCalled()
    }
  )

  it('systemScheduler.now() preserves finite zero and original performance.now throws', async () => {
    const originalError = new Error('clock failed')
    /** Next clock reading or a throwing thunk. */
    let clockValue: number | (() => never) = 0
    vi.stubGlobal('performance', {
      now() {
        if (typeof clockValue === 'function') return clockValue()
        return clockValue
      }
    })
    const scheduler = await reloadedSystemScheduler()
    expect(scheduler.now()).toBe(0)
    clockValue = () => {
      throw originalError
    }
    expect(captureThrow(() => scheduler.now())).toBe(originalError)
  })

  it('fails with ENV_UNSUPPORTED when performance or timers are missing', async () => {
    vi.stubGlobal('performance', undefined)
    const scheduler = await reloadedSystemScheduler()
    expect(captureThrow(() => scheduler.now())).toMatchObject({
      name: 'Error',
      source: '@migaia/utils',
      code: 'ENV_UNSUPPORTED'
    })
    /** Cancellation stub that must stay untouched when registration is missing. */
    const clear = vi.fn()
    vi.stubGlobal('setTimeout', undefined)
    vi.stubGlobal('clearTimeout', clear)
    expect(captureThrow(() => scheduler.schedule(() => undefined, 1))).toMatchObject({
      name: 'Error',
      source: '@migaia/utils',
      code: 'ENV_UNSUPPORTED'
    })
    expect(clear).not.toHaveBeenCalled()
  })
})

describe('A3 systemScheduler timers, segments, unref and cancellation', () => {
  it('segments delays above the host maximum and runs the callback once', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    systemScheduler.schedule(callback, MAXIMUM_TIMER_DELAY + 1)
    vi.advanceTimersByTime(MAXIMUM_TIMER_DELAY)
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(MAXIMUM_TIMER_DELAY)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('keeps unref on every segment with the native timer as receiver, and never unrefs unrequested tasks', () => {
    const { timers } = stubRecordingTimers()
    const callback = vi.fn()
    const task = systemScheduler.schedule(callback, MAXIMUM_TIMER_DELAY + 1)
    task.unref?.()
    expect(timers).toHaveLength(1)
    timers[0]!.callback()
    expect(timers).toHaveLength(2)
    expect(timers[1]!.delayMs).toBe(1)
    expect(timers[0]!.unref).toHaveBeenCalledTimes(1)
    expect(timers[1]!.unref).toHaveBeenCalledTimes(1)
    expect(timers[0]!.receivers).toEqual([timers[0]])
    expect(timers[1]!.receivers).toEqual([timers[1]])
    timers[1]!.callback()
    expect(callback).toHaveBeenCalledTimes(1)

    const plain = systemScheduler.schedule(vi.fn(), MAXIMUM_TIMER_DELAY + 1)
    expect(timers).toHaveLength(3)
    timers[2]!.callback()
    expect(timers).toHaveLength(4)
    expect(timers[2]!.unref).not.toHaveBeenCalled()
    expect(timers[3]!.unref).not.toHaveBeenCalled()
    plain.cancel()
  })

  it('cancel in the first segment is idempotent and stops later segments', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const task = systemScheduler.schedule(callback, MAXIMUM_TIMER_DELAY + 1)
    vi.advanceTimersByTime(1_000)
    expect(() => {
      task.cancel()
      task.cancel()
    }).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(MAXIMUM_TIMER_DELAY * 2)
    expect(callback).not.toHaveBeenCalled()
  })

  it('never runs a zero-delay callback inside schedule()', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    systemScheduler.schedule(callback, 0)
    expect(callback).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['-1', -1, RangeError],
    ['NaN', Number.NaN, RangeError],
    ['Infinity', Number.POSITIVE_INFINITY, RangeError],
    ['string', '1', TypeError]
  ] as const)('rejects delay %s with INVALID_ARGUMENT before any timer', (_label, delay, type) => {
    const { set } = stubRecordingTimers()
    const error = captureThrow(() => systemScheduler.schedule(() => undefined, delay as number))
    expect(error).toBeInstanceOf(type)
    expect(error).toMatchObject({ source: '@migaia/utils', code: 'INVALID_ARGUMENT' })
    expect((error as Error).cause).toBeUndefined()
    expect(set).not.toHaveBeenCalled()
  })

  it('unrefs native system timers with the timer as receiver', () => {
    // Node's Timeout#unref reads internal state from `this`; a detached call throws TypeError.
    const task = systemScheduler.schedule(() => undefined, 60_000)
    try {
      expect(() => task.unref?.()).not.toThrow()
    } finally {
      task.cancel()
    }
  })

  it('systemScheduler.schedule 创建真实 timer，cancel 幂等后不执行', async () => {
    /** Number of callback runs; must stay zero after cancellation. */
    let count = 0
    const task = systemScheduler.schedule(() => {
      count++
    }, 1)
    task.cancel()
    task.cancel()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(count).toBe(0)
  })
})

describe('A4 manual scheduler ordering, overflow, reentrancy and runaway', () => {
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
    /** Number of callback runs. */
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
    /** Number of callback runs. */
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
    const order: string[] = []
    scheduler.schedule(() => order.push('30'), 30)
    scheduler.schedule(() => order.push('10-first'), 10)
    scheduler.schedule(() => order.push('10-second'), 10)
    scheduler.schedule(() => {
      order.push('20')
      scheduler.schedule(() => order.push('20+0'), 0)
    }, 20)
    const cancelled = scheduler.schedule(() => order.push('cancelled'), 15)
    expect(scheduler.pendingCount).toBe(5)
    cancelled.cancel()
    expect(scheduler.pendingCount).toBe(4)
    scheduler.advance(30)
    expect(order).toEqual(['10-first', '10-second', '20', '20+0', '30'])
    expect(scheduler.pendingCount).toBe(0)
  })

  it('manualScheduler preserves finite maximum and zero arithmetic edges', () => {
    const scheduler = createManualScheduler()
    /** Number of callback runs. */
    let runs = 0
    scheduler.advance(Number.MAX_VALUE)
    scheduler.schedule(() => {
      runs++
    }, 0)
    scheduler.advance(0)
    expect(scheduler.now()).toBe(Number.MAX_VALUE)
    expect(runs).toBe(1)
  })

  it('rejects schedule overflow before touching the clock or heap', () => {
    const scheduler = createManualScheduler()
    const callback = vi.fn()
    scheduler.advance(Number.MAX_VALUE)
    const error = captureThrow(() => scheduler.schedule(callback, Number.MAX_VALUE))
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ source: '@migaia/utils', code: 'INVALID_ARGUMENT' })
    expect(scheduler.now()).toBe(Number.MAX_VALUE)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('rejects advance overflow before flushing any due task', () => {
    const scheduler = createManualScheduler()
    const callback = vi.fn()
    scheduler.advance(Number.MAX_VALUE / 2)
    scheduler.schedule(callback, Number.MAX_VALUE / 4)
    const error = captureThrow(() => scheduler.advance(Number.MAX_VALUE))
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ source: '@migaia/utils', code: 'INVALID_ARGUMENT' })
    expect(callback).not.toHaveBeenCalled()
    expect(scheduler.now()).toBe(Number.MAX_VALUE / 2)
    expect(scheduler.pendingCount).toBe(1)
  })

  it.each([
    ['-1', -1, RangeError],
    ['NaN', Number.NaN, RangeError],
    ['string', '1', TypeError]
  ] as const)(
    'rejects schedule and advance argument %s with INVALID_ARGUMENT',
    (_l, value, type) => {
      const scheduler = createManualScheduler()
      for (const run of [
        () => scheduler.schedule(() => undefined, value as number),
        () => scheduler.advance(value as number)
      ]) {
        const error = captureThrow(run)
        expect(error).toBeInstanceOf(type)
        expect(error).toMatchObject({ source: '@migaia/utils', code: 'INVALID_ARGUMENT' })
      }
      expect(scheduler.now()).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    }
  )

  it('rejects a nested advance with REENTRANT_CALL and keeps the clock monotonic', () => {
    const scheduler = createManualScheduler()
    /** Every clock reading observed during the test. */
    const readings: number[] = [scheduler.now()]
    /** Error thrown by the nested advance call. */
    let nested: unknown
    scheduler.schedule(() => {
      readings.push(scheduler.now())
      nested = captureThrow(() => scheduler.advance(100))
      readings.push(scheduler.now())
    }, 10)
    scheduler.advance(10)
    readings.push(scheduler.now())
    expect(nested).toBeInstanceOf(TypeError)
    expect(nested).toMatchObject({ source: '@migaia/utils', code: 'REENTRANT_CALL' })
    expect(readings).toEqual([0, 10, 10, 10])
    scheduler.advance(0)
    expect(scheduler.now()).toBe(10)
  })

  it('throws SCHEDULER_RUNAWAY for a callback that reschedules itself forever', () => {
    const scheduler = createManualScheduler()
    /** Self-rescheduling callback. */
    const loop = (): void => {
      scheduler.schedule(loop, 0)
    }
    scheduler.schedule(loop, 0)
    const error = captureThrow(() => scheduler.advance(0))
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({ source: '@migaia/utils', code: 'SCHEDULER_RUNAWAY' })
    expect(scheduler.now()).toBe(0)
  })

  it('propagates a callback throw and keeps later tasks pending', () => {
    const scheduler = createManualScheduler()
    const failure = new Error('callback failed')
    const later = vi.fn()
    scheduler.schedule(() => {
      throw failure
    }, 1)
    scheduler.schedule(later, 50)
    expect(captureThrow(() => scheduler.advance(10))).toBe(failure)
    expect(later).not.toHaveBeenCalled()
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(50)
    expect(later).toHaveBeenCalledTimes(1)
  })
})

describe('A6 wall clock stays separate from the monotonic clock', () => {
  it('reads Date.now for timestamps and performance.now for now(), independently', async () => {
    /** Date.now stub that can move backwards. */
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_123)
    vi.stubGlobal('performance', { now: () => 7 })
    vi.resetModules()
    const module = await import('../src/scheduler.js')
    expect(module.systemWallClock.timestamp()).toBe(1_700_000_000_123)
    expect(module.systemScheduler.now()).toBe(7)
    dateNow.mockReturnValue(1_600_000_000_000)
    expect(module.systemScheduler.now()).toBe(7)
    expect(module.systemWallClock.timestamp()).toBe(1_600_000_000_000)
    expect(systemWallClock.timestamp()).toBe(1_600_000_000_000)
  })
})

describe('A9 scheduler module stays runtime-neutral', () => {
  it('references no host types, no bare host identifiers and only utils-local imports', () => {
    /** Source text of the scheduler module. */
    const text = readFileSync(new URL('../src/scheduler.ts', import.meta.url), 'utf8')
    const source = ts.createSourceFile('scheduler.ts', text, ts.ScriptTarget.Latest, true)
    /** Module specifiers of every import declaration. */
    const imports: string[] = []
    /** Forbidden type references found. */
    const typeReferences: string[] = []
    /** Bare (non-property) uses of host global identifiers. */
    const bareHostIdentifiers: string[] = []
    /** Host globals that must only be reached through the structural host object. */
    const hostNames = new Set(['setTimeout', 'clearTimeout', 'performance'])
    /** Identifiers that are property names rather than value references. */
    const isPropertyName = (node: ts.Identifier): boolean => {
      const parent = node.parent
      return (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node)
      )
    }
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
        imports.push(node.moduleSpecifier.text)
      if (ts.isTypeReferenceNode(node)) {
        const name = node.typeName.getText(source)
        if (/^(NodeJS|Timeout|Window)\b/.test(name)) typeReferences.push(name)
      }
      if (ts.isTypeQueryNode(node) && /setTimeout|clearTimeout/.test(node.getText(source)))
        typeReferences.push(node.getText(source))
      if (ts.isIdentifier(node) && hostNames.has(node.text) && !isPropertyName(node))
        bareHostIdentifiers.push(node.text)
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(typeReferences).toEqual([])
    expect(bareHostIdentifiers).toEqual([])
    expect(new Set(imports)).toEqual(new Set(['./error.js', './error-code.js', './error-text.js']))
  })
})
