import { describe, expect, it } from 'vitest'
import {
  createPipeline,
  GENERATOR_CONTINUE,
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation,
  type IAsyncGeneratorMiddlewareStage,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type ISyncMiddlewareStage
} from '../src/index.js'

describe('createPipeline', () => {
  it('A1 runs all modes through one stable argument list', async () => {
    /** Values committed by each mode's terminal callback. */
    const values: number[] = []
    /** Two sync stages representing one complete sync chain. */
    const syncStages: readonly ISyncMiddlewareStage<number>[] = [
      (value, next) => next(value + 1),
      (value, next) => next(value + 1)
    ]
    /** Two async stages representing one complete async chain. */
    const asyncStages: readonly IAsyncMiddlewareStage<number>[] = [
      (value, next) => next(value + 1),
      (value, next) => next(value + 1)
    ]
    /** Two generator stages representing one complete generator chain. */
    const generatorStages: readonly IGeneratorMiddlewareStage<number>[] = [
      function* (value) {
        yield value + 1
        return GENERATOR_CONTINUE
      },
      function* (value) {
        yield value + 1
        return GENERATOR_CONTINUE
      }
    ]
    /** Two async-generator stages representing one complete async-generator chain. */
    const asyncGeneratorStages: readonly IAsyncGeneratorMiddlewareStage<number>[] = [
      async function* (value) {
        yield value + 1
        return GENERATOR_CONTINUE
      },
      async function* (value) {
        yield value + 1
        return GENERATOR_CONTINUE
      }
    ]

    /** Sync runner proves the conditional result remains synchronous. */
    const sync = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })
    /** Async runner proves the conditional result remains a Promise. */
    const async = createPipeline<number>({ mode: MiddlewarePipelineMode.async })
    /** Generator runner proves the conditional result remains synchronous. */
    const generator = createPipeline<number>({ mode: MiddlewarePipelineMode.generator })
    /** Async-generator runner proves the conditional result remains a Promise. */
    const asyncGenerator = createPipeline<number>({
      mode: MiddlewarePipelineMode.asyncGenerator
    })
    /** Compile-time and runtime sync result. */
    const syncResult: void = sync.run(syncStages, 1, (value) => values.push(value))
    /** Compile-time and runtime async result. */
    const asyncResult: Promise<void> = async.run(asyncStages, 1, (value) => {
      values.push(value)
    })
    /** Compile-time and runtime generator result. */
    const generatorResult: void = generator.run(generatorStages, 1, (value) => values.push(value))
    /** Compile-time and runtime async-generator result. */
    const asyncGeneratorResult: Promise<void> = asyncGenerator.run(
      asyncGeneratorStages,
      1,
      (value) => {
        values.push(value)
      }
    )

    expect(sync.mode).toBe(MiddlewarePipelineMode.sync)
    expect(async.mode).toBe(MiddlewarePipelineMode.async)
    expect(generator.mode).toBe(MiddlewarePipelineMode.generator)
    expect(asyncGenerator.mode).toBe(MiddlewarePipelineMode.asyncGenerator)
    expect(syncResult).toBeUndefined()
    expect(generatorResult).toBeUndefined()
    await expect(asyncResult).resolves.toBeUndefined()
    await expect(asyncGeneratorResult).resolves.toBeUndefined()
    expect(values).toEqual([3, 3, 3, 3])
  })

  it('A2 applies active checks at every mode boundary and prefers run control signal', async () => {
    /** Exact host activity failure that must remain top-level. */
    const activeFailure = new Error('inactive')
    /** Records each mode's stage and terminal activity. */
    const trace: string[] = []
    /** Builds a guard that fails after one stage has completed. */
    const createAssertActive = (): (() => void) => {
      let checks = 0
      return () => {
        checks += 1
        if (checks === 2) throw activeFailure
      }
    }

    /** Sync pipeline under the shared activity policy. */
    const sync = createPipeline<number>({
      mode: MiddlewarePipelineMode.sync,
      assertActive: createAssertActive()
    })
    expect(() =>
      sync.run(
        [
          (value, next) => {
            trace.push('sync:first')
            next(value + 1)
          },
          (value, next) => {
            trace.push('sync:second')
            next(value + 1)
          }
        ],
        1,
        () => trace.push('sync:done')
      )
    ).toThrow(activeFailure)

    /** Generator pipeline under the shared activity policy. */
    const generator = createPipeline<number>({
      mode: MiddlewarePipelineMode.generator,
      assertActive: createAssertActive()
    })
    expect(() =>
      generator.run(
        [
          function* (value) {
            trace.push('generator:first')
            yield value + 1
            return GENERATOR_CONTINUE
          },
          function* (value) {
            trace.push('generator:second')
            yield value + 1
            return GENERATOR_CONTINUE
          }
        ],
        1,
        () => trace.push('generator:done')
      )
    ).toThrow(activeFailure)

    /** Async pipeline under the shared activity policy. */
    const async = createPipeline<number>({
      mode: MiddlewarePipelineMode.async,
      assertActive: createAssertActive()
    })
    await expect(
      async.run(
        [
          (value, next) => {
            trace.push('async:first')
            return next(value + 1)
          },
          (value, next) => {
            trace.push('async:second')
            return next(value + 1)
          }
        ],
        1,
        () => trace.push('async:done')
      )
    ).rejects.toBe(activeFailure)

    /** Async-generator pipeline under the shared activity policy. */
    const asyncGenerator = createPipeline<number>({
      mode: MiddlewarePipelineMode.asyncGenerator,
      assertActive: createAssertActive()
    })
    await expect(
      asyncGenerator.run(
        [
          async function* (value) {
            trace.push('async-generator:first')
            yield value + 1
            return GENERATOR_CONTINUE
          },
          async function* (value) {
            trace.push('async-generator:second')
            yield value + 1
            return GENERATOR_CONTINUE
          }
        ],
        1,
        () => trace.push('async-generator:done')
      )
    ).rejects.toBe(activeFailure)

    expect(trace).toEqual([
      'sync:first',
      'generator:first',
      'async:first',
      'async-generator:first'
    ])

    /** Creation-time signal remains active while call-time control is already aborted. */
    const creationController = new AbortController()
    /** Call-time signal must override the creation-time signal. */
    const controlController = new AbortController()
    controlController.abort('stop')
    /** Stage call count proves admission fails before user code. */
    let stageCalls = 0
    /** Sync pipeline used to prove signal precedence without async timing. */
    const signalPipeline = createPipeline<number>({
      mode: MiddlewarePipelineMode.sync,
      signal: creationController.signal
    })
    expect(() =>
      signalPipeline.run(
        [(_value, _next) => {
          stageCalls += 1
        }],
        1,
        () => undefined,
        { signal: controlController.signal }
      )
    ).toThrow(expect.objectContaining({ code: MiddlewarePipelineErrorCode.aborted }))
    expect(stageCalls).toBe(0)
  })

  it('A4 lifts only supported mode pairs and preserves adapter semantics', async () => {
    /** Violation stream emitted by the lifted sync stage. */
    const violations: string[] = []
    /** Async target owns violation reporting for lifted sync stages. */
    const async = createPipeline<number>({
      mode: MiddlewarePipelineMode.async,
      onViolation: (kind) => violations.push(kind)
    })
    /** Sync stage deliberately violates the single-next contract. */
    const syncStage: ISyncMiddlewareStage<number> = (value, next) => {
      next(value + 1)
      next(value + 2)
    }
    await async.run([async.lift(syncStage, MiddlewarePipelineMode.sync)], 1, () => undefined)
    expect(violations).toEqual([MiddlewarePipelineViolation.duplicate])

    /** Same-mode lift must preserve exact stage identity. */
    const asyncStage: IAsyncMiddlewareStage<number> = (_value, _next) => undefined
    expect(async.lift(asyncStage, MiddlewarePipelineMode.async)).toBe(asyncStage)

    /** Sync target rejects an async source even when runtime input bypasses type safety. */
    const sync = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })
    /** Captured unsupported-lift failure for native-type and identity assertions. */
    let unsupportedFailure: unknown
    try {
      sync.lift(asyncStage, MiddlewarePipelineMode.async as never)
    } catch (error) {
      unsupportedFailure = error
    }
    expect(unsupportedFailure).toBeInstanceOf(TypeError)
    expect(unsupportedFailure).toMatchObject({
      code: MiddlewarePipelineErrorCode.invalidOption,
      source: MIDDLEWARE_PIPELINE_SOURCE
    })
    expect((unsupportedFailure as Error).cause).toBeUndefined()

    /** Generator stage proves canonical generator-to-async-generator promotion. */
    const generatorStage: IGeneratorMiddlewareStage<number> = function* (value) {
      yield value + 1
      return GENERATOR_CONTINUE
    }
    /** Async-generator target receives the lifted generator stage. */
    const asyncGenerator = createPipeline<number>({
      mode: MiddlewarePipelineMode.asyncGenerator
    })
    /** Terminal values prove the promoted stage retained its first yield. */
    const values: number[] = []
    await asyncGenerator.run(
      [asyncGenerator.lift(generatorStage, MiddlewarePipelineMode.generator)],
      1,
      (value) => values.push(value)
    )
    expect(values).toEqual([2])
  })

  it('A6 rejects malformed createPipeline options before runner construction', () => {
    /** Invalid calls bypass static typing to exercise package-boundary admission. */
    const invalidCalls: readonly (() => unknown)[] = [
      () => createPipeline(null as never),
      () => createPipeline({ mode: 'parallel' } as never),
      () => createPipeline({ mode: MiddlewarePipelineMode.sync, onViolation: 1 } as never),
      () =>
        createPipeline({
          mode: MiddlewarePipelineMode.generator,
          signals: { halt: Symbol('halt') }
        } as never)
    ]

    for (const invoke of invalidCalls) {
      /** Captured admission failure for native-type and no-cause assertions. */
      let invalidFailure: unknown
      try {
        invoke()
      } catch (error) {
        invalidFailure = error
      }
      expect(invalidFailure).toBeInstanceOf(TypeError)
      expect(invalidFailure).toMatchObject({ code: MiddlewarePipelineErrorCode.invalidOption })
      expect((invalidFailure as Error).cause).toBeUndefined()
    }
  })
})
