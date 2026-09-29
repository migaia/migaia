import { describe, expect, it } from 'vitest'
import { createRuntime, ReactiveErrorPhase } from '../src/index.js'
import { ReactiveErrorCode } from '../src/error-code.js'
import { Scheduler } from '../src/runtime/scheduler.class.js'

/** Runs a batch whose action, flush, and hostile cause getter fail in that order. */
function runRuntimeFailure(
  getterFailure: unknown,
  onError?: NonNullable<Parameters<typeof createRuntime>[0]>['onError'],
  reenterReport = false
): { caught: unknown; actionError: Error; flushError: Error; reads: number; stacks: string[] } {
  const runtime = createRuntime({
    onError: reenterReport
      ? () => {
          runtime.batch(() => undefined)
        }
      : onError
  })
  const signal = runtime.signal(0)
  const actionError = new Error('action failed')
  const flushError = new Error('flush failed')
  const stacks = [actionError.stack!, flushError.stack!]
  let reads = 0
  Object.defineProperty(actionError, 'cause', {
    get: () => {
      reads += 1
      throw getterFailure
    }
  })
  const dispose = runtime.effect(() => {
    if (signal.value === 1) throw flushError
  })
  let caught: unknown
  try {
    runtime.batch(() => {
      signal.value = 1
      throw actionError
    })
  } catch (error) {
    caught = error
  } finally {
    dispose()
    signal.dispose()
  }
  return { caught, actionError, flushError, reads, stacks }
}

describe('batch cause-read reporting', () => {
  it('A1 reports the original getter failure and keeps all three errors in order', () => {
    const getterFailure = new Error('cause getter failed')
    const getterStack = getterFailure.stack
    const reports: Array<{ error: unknown; context: unknown }> = []
    const result = runRuntimeFailure(getterFailure, (error, context) => {
      reports.push({ error, context })
    })
    expect(result.caught).toBeInstanceOf(AggregateError)
    expect(result.caught).toMatchObject({ code: ReactiveErrorCode.actionFlushFailed })
    expect((result.caught as AggregateError).errors).toEqual([
      result.actionError,
      result.flushError,
      getterFailure
    ])
    expect((result.caught as AggregateError).errors[0]).toBe(result.actionError)
    expect((result.caught as AggregateError).errors[1]).toBe(result.flushError)
    expect((result.caught as AggregateError).errors[2]).toBe(getterFailure)
    expect([result.actionError.stack, result.flushError.stack, getterFailure.stack]).toEqual([
      ...result.stacks,
      getterStack
    ])
    expect(result.reads).toBe(1)
    expect(reports).toEqual([
      { error: getterFailure, context: { phase: ReactiveErrorPhase.causeRead } }
    ])
  })

  it('A2 contains reporter failures without replacing the original error chain', async () => {
    const direct = runRuntimeFailure(undefined)
    expect(direct.caught).toBeInstanceOf(AggregateError)
    expect((direct.caught as AggregateError).errors).toEqual([
      direct.actionError,
      direct.flushError,
      undefined
    ])
    expect(direct.reads).toBe(1)

    const reporterError = new Error('reporter failed')
    const sync = runRuntimeFailure('getter failed', () => {
      throw reporterError
    })
    const asyncResult = runRuntimeFailure('getter failed', () => Promise.reject(reporterError))
    for (const result of [sync, asyncResult]) {
      expect(result.caught).toMatchObject({ code: ReactiveErrorCode.actionFlushFailed })
      expect((result.caught as AggregateError).errors).toEqual([
        result.actionError,
        result.flushError,
        'getter failed'
      ])
      expect(result.reads).toBe(1)
    }
    await Promise.resolve()
    await Promise.resolve()

    const scheduler = new Scheduler(() => {
      throw reporterError
    })
    const actionError = new Error('direct action failed')
    const flushError = new Error('direct flush failed')
    Object.defineProperty(actionError, 'cause', {
      get: () => {
        throw 'direct getter failed'
      }
    })
    let caught: unknown
    try {
      scheduler.runBatched(() => {
        scheduler.enqueue({
          tick: () => {
            throw flushError
          }
        })
        throw actionError
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: ReactiveErrorCode.actionFlushFailed })
    expect((caught as AggregateError).errors).toEqual([
      actionError,
      flushError,
      'direct getter failed',
      reporterError
    ])

    const reentrant = runRuntimeFailure('reentrant getter failed', undefined, true)
    expect((reentrant.caught as AggregateError).errors).toEqual([
      reentrant.actionError,
      reentrant.flushError,
      'reentrant getter failed'
    ])
  })

  it('A3 preserves normal, existing-cause, and frozen-error outcomes', () => {
    for (const withCause of [false, true]) {
      const reports: unknown[] = []
      const runtime = createRuntime({ onError: (error) => reports.push(error) })
      const signal = runtime.signal(0)
      const actionError = new Error('action failed')
      const flushError = new Error('flush failed')
      const oldCause = new Error('old cause')
      let reads = 0
      if (withCause) {
        Object.defineProperty(actionError, 'cause', {
          configurable: true,
          get: () => {
            reads += 1
            return oldCause
          }
        })
      }
      const dispose = runtime.effect(() => {
        if (signal.value === 1) throw flushError
      })
      let caught: unknown
      try {
        runtime.batch(() => {
          signal.value = 1
          throw actionError
        })
      } catch (error) {
        caught = error
      } finally {
        dispose()
        signal.dispose()
      }
      expect(caught).toBe(actionError)
      if (withCause) {
        expect((actionError.cause as AggregateError).errors).toEqual([oldCause, flushError])
        expect(reads).toBe(1)
      } else {
        expect(actionError.cause).toBe(flushError)
      }
      expect(reports).toEqual([])
    }

    const scheduler = new Scheduler()
    const frozenError = Object.freeze(new Error('frozen action'))
    const flushError = new Error('frozen flush')
    let caught: unknown
    try {
      scheduler.runBatched(() => {
        scheduler.enqueue({
          tick: () => {
            throw flushError
          }
        })
        throw frozenError
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: ReactiveErrorCode.actionFlushFailed })
    expect((caught as AggregateError).errors).toEqual([frozenError, flushError])
  })
})
