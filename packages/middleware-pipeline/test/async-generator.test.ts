import { describe, expect, it } from 'vitest'
import {
  adaptGeneratorStageToAsyncGenerator,
  adaptSyncStageToAsyncGenerator,
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  MiddlewarePipelineMode,
  runAsyncGeneratorMiddleware
} from '../src/index.js'
import type { IAsyncGeneratorMiddlewareStage, IMiddlewarePipelineMode } from '../src/index.js'

describe('runAsyncGeneratorMiddleware', () => {
  it('exports the additive async-generator mode without changing existing identities', () => {
    /** Compile-time witness for the expanded public mode union. */
    const mode: IMiddlewarePipelineMode = MiddlewarePipelineMode.asyncGenerator
    expect(mode).toBe('async-generator')
    expect(MiddlewarePipelineMode).toMatchObject({
      sync: 'sync',
      async: 'async',
      generator: 'generator'
    })
  })

  it('serially drains each stage and awaits done', async () => {
    /** Observable ordering across stage bodies, yields, returns, and done settlement. */
    const events: string[] = []
    /** First stage proves async work and multiple yields finish before stage two starts. */
    const first: IAsyncGeneratorMiddlewareStage<number> = async function* (value) {
      events.push('first:start')
      await Promise.resolve()
      yield value + 1
      events.push('first:yielded')
      yield value + 2
      events.push('first:end')
      return GENERATOR_CONTINUE
    }
    /** Second stage records the last yielded candidate selected by CONTINUE. */
    const second: IAsyncGeneratorMiddlewareStage<number> = async function* (value) {
      events.push(`second:${value}`)
      return value * 2
    }

    await runAsyncGeneratorMiddleware([first, second], 1, async (value) => {
      events.push(`done:${value}:start`)
      await Promise.resolve()
      events.push('done:end')
    })

    expect(events).toEqual([
      'first:start',
      'first:yielded',
      'first:end',
      'second:3',
      'done:6:start',
      'done:end'
    ])
  })

  it('supports zero-yield CONTINUE and ordinary terminal values', async () => {
    /** Values delivered after zero-yield continuation and a normal return. */
    const values: number[] = []
    await runAsyncGeneratorMiddleware<number>(
      [
        async function* () {
          return GENERATOR_CONTINUE
        },
        async function* (value) {
          return value + 4
        }
      ],
      2,
      (value) => {
        values.push(value)
      }
    )
    expect(values).toEqual([6])
  })

  it('distinguishes HALT, implicit return, and an explicit undefined payload', async () => {
    /** Done values across three independent terminal-signal executions. */
    const values: (string | undefined)[] = []
    await runAsyncGeneratorMiddleware<string>(
      [
        async function* () {
          return GENERATOR_HALT
        }
      ],
      'halt',
      (value) => {
        values.push(value)
      }
    )
    await runAsyncGeneratorMiddleware<string>(
      [
        async function* () {
          return undefined
        }
      ],
      'implicit',
      (value) => {
        values.push(value)
      }
    )
    await runAsyncGeneratorMiddleware<string | undefined>(
      [
        async function* () {
          return GENERATOR_UNDEFINED
        }
      ],
      'defined',
      (value) => {
        values.push(value)
      }
    )
    expect(values).toEqual([undefined])
  })

  it('accepts host-owned generator signal identities', async () => {
    /** Host-owned symbols proving the runner does not hard-code package signal identity. */
    const signals = {
      undefined: Symbol('host.undefined'),
      halt: Symbol('host.halt'),
      continue: Symbol('host.continue')
    }
    /** Final value selected through the host-owned continue signal. */
    const values: (number | symbol)[] = []
    await runAsyncGeneratorMiddleware<number | symbol>(
      [
        async function* (value) {
          yield (value as number) + 1
          return signals.continue
        }
      ],
      1,
      (value) => {
        values.push(value)
      },
      signals
    )
    expect(values).toEqual([2])
  })

  it('snapshots replacement, insertion, and deletion before async-generator dispatch', async () => {
    /** Stages intentionally mutated after dispatch has captured its snapshot. */
    const stages: IAsyncGeneratorMiddlewareStage<number>[] = []
    /** Original execution order proving mutations do not affect the active run. */
    const calls: string[] = []
    /** First stage replaces the caller array while preserving the active snapshot. */
    const first: IAsyncGeneratorMiddlewareStage<number> = async function* (value) {
      calls.push('first')
      stages.splice(
        0,
        stages.length,
        async function* () {
          calls.push('replacement')
          return 99
        },
        async function* () {
          calls.push('insertion')
          return 100
        }
      )
      return value + 1
    }
    /** Original second stage must remain in the captured dispatch. */
    const second: IAsyncGeneratorMiddlewareStage<number> = async function* (value) {
      calls.push('second')
      return value + 1
    }
    /** Original third stage must remain despite caller-array deletion. */
    const third: IAsyncGeneratorMiddlewareStage<number> = async function* (value) {
      calls.push('third')
      return value + 1
    }
    stages.push(first, second, third)

    await runAsyncGeneratorMiddleware(stages, 0, (value) => {
      calls.push(`done:${value}`)
    })

    expect(calls).toEqual(['first', 'second', 'third', 'done:3'])
  })

  it('propagates factory, iterator, and done failures by exact identity', async () => {
    /** Exact synchronous factory failure. */
    const factoryError = new Error('factory failed')
    /** Exact asynchronous generator-body failure. */
    const iteratorError = new Error('iterator failed')
    /** Exact terminal callback failure. */
    const doneError = new Error('done failed')
    /** Stage whose factory fails before producing an iterator. */
    const factoryFailure: IAsyncGeneratorMiddlewareStage<number> = () => {
      throw factoryError
    }
    /** Stage proving yielded candidates are not committed before terminal success. */
    const iteratorFailure: IAsyncGeneratorMiddlewareStage<number> = async function* (value) {
      yield value + 1
      throw iteratorError
    }
    /** Downstream observation must remain empty after iterator rejection. */
    const downstream: number[] = []

    await expect(runAsyncGeneratorMiddleware([factoryFailure], 1, () => undefined)).rejects.toBe(
      factoryError
    )
    await expect(
      runAsyncGeneratorMiddleware(
        [
          iteratorFailure,
          async function* (value) {
            downstream.push(value)
            return value
          }
        ],
        1,
        () => undefined
      )
    ).rejects.toBe(iteratorError)
    await expect(
      runAsyncGeneratorMiddleware([], 1, () => {
        throw doneError
      })
    ).rejects.toBe(doneError)
    expect(downstream).toEqual([])
  })
})

describe('async-generator adapters', () => {
  it('promotes a generator stage without changing yield, terminal, or error identity', async () => {
    /** Number of synchronous generator factory invocations. */
    let calls = 0
    /** Original generator stage with two yielded candidates. */
    const stage: import('../src/index.js').IGeneratorMiddlewareStage<number> = function* (value) {
      calls += 1
      yield value + 1
      yield value + 2
      return GENERATOR_CONTINUE
    }
    /** Values delivered by the promoted stage. */
    const values: number[] = []
    await runAsyncGeneratorMiddleware([adaptGeneratorStageToAsyncGenerator(stage)], 1, (value) => {
      values.push(value)
    })
    expect(values).toEqual([3])
    expect(calls).toBe(1)

    /** Terminal outcomes delivered across ordinary, halt, and undefined promotion paths. */
    const terminalValues: (number | undefined)[] = []
    await runAsyncGeneratorMiddleware(
      [
        adaptGeneratorStageToAsyncGenerator<number>(function* () {
          return 4
        })
      ],
      1,
      (value) => {
        terminalValues.push(value)
      }
    )
    await runAsyncGeneratorMiddleware(
      [
        adaptGeneratorStageToAsyncGenerator<number>(function* () {
          return GENERATOR_HALT
        })
      ],
      1,
      (value) => {
        terminalValues.push(value)
      }
    )
    await runAsyncGeneratorMiddleware<number | undefined>(
      [
        adaptGeneratorStageToAsyncGenerator<number | undefined>(function* () {
          return GENERATOR_UNDEFINED
        })
      ],
      1,
      (value) => {
        terminalValues.push(value)
      }
    )
    expect(terminalValues).toEqual([4, undefined])

    /** Exact error thrown by a promoted synchronous iterator. */
    const error = new Error('generator failed')
    await expect(
      runAsyncGeneratorMiddleware(
        [
          adaptGeneratorStageToAsyncGenerator<number>(function* () {
            throw error
          })
        ],
        1,
        () => undefined
      )
    ).rejects.toBe(error)
  })

  it('promotes sync pass, short-circuit, duplicate, late, and throw semantics', async () => {
    /** Violations reported by the existing sync-to-generator guard. */
    const violations: string[] = []
    /** Stored next callback used to verify late reporting after the first yield. */
    let savedNext: ((value: number) => void) | undefined
    /** Adapted sync stage intentionally invokes next twice. */
    const adapted = adaptSyncStageToAsyncGenerator(
      (value: number, next) => {
        savedNext = next
        next(value + 1)
        next(value + 2)
      },
      (violation) => violations.push(violation)
    )
    /** Iterator retained so late invocation occurs after the wrapped stage returned. */
    const iterator = adapted(1)
    expect(await iterator.next()).toEqual({ value: 2, done: false })
    savedNext?.(4)
    expect(violations).toEqual(['duplicate', 'late'])

    /** Exact reporter failure preserved through the composed adapter path. */
    const reporterError = new Error('reporter failed')
    await expect(
      adaptSyncStageToAsyncGenerator(
        (value: number, next) => {
          next(value)
          next(value)
        },
        () => {
          throw reporterError
        }
      )(1).next()
    ).rejects.toBe(reporterError)

    /** Done values proving a sync stage that omits next still short-circuits. */
    const values: number[] = []
    await runAsyncGeneratorMiddleware(
      [
        adaptSyncStageToAsyncGenerator(
          () => undefined,
          () => undefined
        )
      ],
      1,
      (value) => {
        values.push(value)
      }
    )
    expect(values).toEqual([])

    /** Exact synchronous error preserved through both adapter layers. */
    const error = new Error('sync failed')
    await expect(
      runAsyncGeneratorMiddleware(
        [
          adaptSyncStageToAsyncGenerator(
            () => {
              throw error
            },
            () => undefined
          )
        ],
        1,
        () => undefined
      )
    ).rejects.toBe(error)
  })
})
