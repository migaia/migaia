import { describe, expect, it } from 'vitest'
import {
  createPipeline,
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
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
        () => {
          trace.push('async:done')
        }
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
        () => {
          trace.push('async-generator:done')
        }
      )
    ).rejects.toBe(activeFailure)

    expect(trace).toEqual(['sync:first', 'generator:first', 'async:first', 'async-generator:first'])

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
        [
          (_value, _next) => {
            stageCalls += 1
          }
        ],
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
      sync.lift(asyncStage as never, MiddlewarePipelineMode.async as never)
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
      (value) => {
        values.push(value)
      }
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

  it('A8 keeps ordinary failures primary across every mode', async () => {
    /** Mutable signal state used to place abort after downstream entry. */
    let asyncAborted = false
    /** Abort reason must never replace an already captured ordinary failure. */
    const abortFailure = new Error('abort')
    /** Structural signal whose state changes inside the running stage. */
    const asyncSignal = {
      get aborted() {
        return asyncAborted
      },
      reason: abortFailure,
      addEventListener() {},
      removeEventListener() {}
    }
    /** Exact downstream failure that must remain the top-level result. */
    const downstreamFailure = new Error('downstream')
    /** Counts calls to the dual-failure combiner. */
    let combineCalls = 0
    /** Async pipeline proving a later abort does not replace downstream failure. */
    const async = createPipeline<number>({
      mode: MiddlewarePipelineMode.async,
      signal: asyncSignal,
      combineStageAndDownstreamError: () => {
        combineCalls += 1
        return new Error('combined')
      }
    })
    await expect(
      async.run(
        [
          async (_value, next) => {
            const pending = next(2)
            asyncAborted = true
            await pending
          },
          async () => {
            throw downstreamFailure
          }
        ],
        1,
        () => undefined
      )
    ).rejects.toBe(downstreamFailure)
    expect(combineCalls).toBe(0)

    /** Independent upstream failure used by both composition branches. */
    const stageFailure = new Error('stage')
    /** Independent downstream failure used by both composition branches. */
    const independentDownstreamFailure = new Error('independent-downstream')
    /** Exact pair observed by the host-provided combiner. */
    let combinedPair: readonly unknown[] | undefined
    /** Stable host result returned by the custom combiner. */
    const combinedFailure = new Error('host-combined')
    /** Pipeline proving independent ordinary failures still use the host combiner once. */
    const combined = createPipeline<number>({
      mode: MiddlewarePipelineMode.async,
      combineStageAndDownstreamError: (stage, downstream) => {
        combinedPair = [stage, downstream]
        return combinedFailure
      }
    })
    await expect(
      combined.run(
        [
          async (_value, next) => {
            void next(2)
            throw stageFailure
          },
          async () => {
            throw independentDownstreamFailure
          }
        ],
        1,
        () => undefined
      )
    ).rejects.toBe(combinedFailure)
    expect(combinedPair).toEqual([stageFailure, independentDownstreamFailure])

    /** Pipeline proving default dual-failure composition preserves ordered identities. */
    const aggregate = createPipeline<number>({ mode: MiddlewarePipelineMode.async })
    /** Captured default aggregate for code and ordered-error assertions. */
    let aggregateFailure: unknown
    try {
      await aggregate.run(
        [
          async (_value, next) => {
            void next(2)
            throw stageFailure
          },
          async () => {
            throw independentDownstreamFailure
          }
        ],
        1,
        () => undefined
      )
    } catch (error) {
      aggregateFailure = error
    }
    expect(aggregateFailure).toBeInstanceOf(AggregateError)
    expect(aggregateFailure).toMatchObject({
      code: MiddlewarePipelineErrorCode.executionFailed,
      errors: [stageFailure, independentDownstreamFailure]
    })

    /** Ordinary failure for sync precedence. */
    const syncFailure = new Error('sync')
    /** Mutable sync abort state. */
    let syncAborted = false
    /** Sync signal switched immediately before user failure. */
    const syncSignal = {
      get aborted() {
        return syncAborted
      },
      reason: abortFailure,
      addEventListener() {},
      removeEventListener() {}
    }
    /** Sync pipeline proving user throw precedes post-stage abort. */
    const sync = createPipeline<number>({ mode: MiddlewarePipelineMode.sync, signal: syncSignal })
    expect(() =>
      sync.run(
        [
          () => {
            syncAborted = true
            throw syncFailure
          }
        ],
        1,
        () => undefined
      )
    ).toThrow(syncFailure)

    /** Ordinary failure for generator precedence. */
    const generatorFailure = new Error('generator')
    /** Mutable generator abort state. */
    let generatorAborted = false
    /** Generator signal switched immediately before iterator failure. */
    const generatorSignal = {
      get aborted() {
        return generatorAborted
      },
      reason: abortFailure,
      addEventListener() {},
      removeEventListener() {}
    }
    /** Generator pipeline proving iterator throw precedes abort. */
    const generator = createPipeline<number>({
      mode: MiddlewarePipelineMode.generator,
      signal: generatorSignal
    })
    expect(() =>
      generator.run(
        [
          function* () {
            generatorAborted = true
            throw generatorFailure
          }
        ],
        1,
        () => undefined
      )
    ).toThrow(generatorFailure)

    /** Ordinary failure for async-generator precedence. */
    const asyncGeneratorFailure = new Error('async-generator')
    /** Mutable async-generator abort state. */
    let asyncGeneratorAborted = false
    /** Async-generator signal switched immediately before iterator rejection. */
    const asyncGeneratorSignal = {
      get aborted() {
        return asyncGeneratorAborted
      },
      reason: abortFailure,
      addEventListener() {},
      removeEventListener() {}
    }
    /** Async-generator pipeline proving iterator rejection precedes abort. */
    const asyncGenerator = createPipeline<number>({
      mode: MiddlewarePipelineMode.asyncGenerator,
      signal: asyncGeneratorSignal
    })
    await expect(
      asyncGenerator.run(
        [
          async function* () {
            asyncGeneratorAborted = true
            throw asyncGeneratorFailure
          }
        ],
        1,
        () => undefined
      )
    ).rejects.toBe(asyncGeneratorFailure)
  })

  it('A8 combines an unchanged same-error pair while the signal is active', async () => {
    /** Same object occupies both channels without cancellation. */
    const downstream = new Error('downstream')
    /** Captures the exact pair and the number of combination calls. */
    const pairs: Array<readonly unknown[]> = []
    /** Host-defined combined result. */
    const combined = new Error('combined')
    /** Async runner retaining the pre-BC3 ordinary dual-failure rule. */
    const pipeline = createPipeline<number>({
      mode: MiddlewarePipelineMode.async,
      combineStageAndDownstreamError: (stage, child) => {
        pairs.push([stage, child])
        return combined
      }
    })
    await expect(
      pipeline.run(
        [
          async (_value, next) => {
            await next(2)
          },
          async () => {
            throw downstream
          }
        ],
        1,
        () => undefined
      )
    ).rejects.toBe(combined)
    expect(pairs).toEqual([[downstream, downstream]])
  })

  it('A8 keeps a fire-and-forget downstream failure after abort', async () => {
    /** Mutable cancellation state switched after downstream dispatch starts. */
    let aborted = false
    /** Distinct cancellation reason. */
    const abort = new Error('abort')
    /** Signal observed by the async runner. */
    const signal = {
      get aborted() {
        return aborted
      },
      reason: abort,
      addEventListener() {},
      removeEventListener() {}
    }
    /** Downstream user failure remains the rejection value. */
    const downstream = new Error('downstream')
    /** Counts forbidden combination calls for one ordinary failure. */
    let combineCalls = 0
    /** Runner for the fire-and-forget branch. */
    const pipeline = createPipeline<number>({
      mode: MiddlewarePipelineMode.async,
      signal,
      combineStageAndDownstreamError: () => {
        combineCalls += 1
        return new Error('combined')
      }
    })
    await expect(
      pipeline.run(
        [
          (_value, next) => {
            void next(2)
            aborted = true
          },
          async () => {
            await Promise.resolve()
            throw downstream
          }
        ],
        1,
        () => undefined
      )
    ).rejects.toBe(downstream)
    expect(combineCalls).toBe(0)
  })

  it('A8 keeps done failures primary after abort in every mode', async () => {
    /** One failure identity returned by every terminal callback. */
    const doneFailure = new Error('done')
    /** Separate cancellation reason must not become the result. */
    const abort = new Error('abort')
    /** Mutable signal source for each independent run. */
    const createControl = () => {
      let aborted = false
      return {
        signal: {
          get aborted() {
            return aborted
          },
          reason: abort,
          addEventListener() {},
          removeEventListener() {}
        },
        abort: () => {
          aborted = true
        }
      }
    }

    /** Sync terminal callback sets cancellation before throwing. */
    const syncControl = createControl()
    const sync = createPipeline<number>({
      mode: MiddlewarePipelineMode.sync,
      signal: syncControl.signal
    })
    expect(() =>
      sync.run([(value, next) => next(value + 1)], 1, () => {
        syncControl.abort()
        throw doneFailure
      })
    ).toThrow(doneFailure)

    /** Async stage awaits the terminal rejection through next(). */
    const asyncControl = createControl()
    let combineCalls = 0
    const async = createPipeline<number>({
      mode: MiddlewarePipelineMode.async,
      signal: asyncControl.signal,
      combineStageAndDownstreamError: () => {
        combineCalls += 1
        return new Error('combined')
      }
    })
    await expect(
      async.run([async (value, next) => await next(value + 1)], 1, async () => {
        asyncControl.abort()
        throw doneFailure
      })
    ).rejects.toBe(doneFailure)
    expect(combineCalls).toBe(0)

    /** Generator terminal callback sets cancellation before throwing. */
    const generatorControl = createControl()
    const generator = createPipeline<number>({
      mode: MiddlewarePipelineMode.generator,
      signal: generatorControl.signal
    })
    expect(() =>
      generator.run(
        [
          function* (value) {
            return value + 1
          }
        ],
        1,
        () => {
          generatorControl.abort()
          throw doneFailure
        }
      )
    ).toThrow(doneFailure)

    /** Async-generator terminal callback sets cancellation before rejecting. */
    const asyncGeneratorControl = createControl()
    const asyncGenerator = createPipeline<number>({
      mode: MiddlewarePipelineMode.asyncGenerator,
      signal: asyncGeneratorControl.signal
    })
    await expect(
      asyncGenerator.run(
        [
          async function* (value) {
            return value + 1
          }
        ],
        1,
        async () => {
          asyncGeneratorControl.abort()
          throw doneFailure
        }
      )
    ).rejects.toBe(doneFailure)
  })

  it('A8/A9 stops every mode at the first successful post-stage abort checkpoint', async () => {
    /** Shared abort reason expected from every mode. */
    const abortFailure = new Error('stop')
    /** Trace proves no second stage or terminal callback runs. */
    const trace: string[] = []

    /** Creates one mutable structural signal for an isolated invocation. */
    const createSignal = (): {
      readonly signal: {
        readonly aborted: boolean
        readonly reason: Error
        addEventListener(): void
        removeEventListener(): void
      }
      abort(): void
    } => {
      let aborted = false
      return {
        signal: {
          get aborted() {
            return aborted
          },
          reason: abortFailure,
          addEventListener() {},
          removeEventListener() {}
        },
        abort: () => {
          aborted = true
        }
      }
    }

    /** Sync invocation stopped after its first stage returns. */
    const syncControl = createSignal()
    /** Sync pipeline under one mutable signal. */
    const sync = createPipeline<number>({
      mode: MiddlewarePipelineMode.sync,
      signal: syncControl.signal
    })
    expect(() =>
      sync.run(
        [
          (value, next) => {
            trace.push('sync:first')
            next(value + 1)
            syncControl.abort()
          },
          () => trace.push('sync:second')
        ],
        1,
        () => trace.push('sync:done')
      )
    ).toThrow(abortFailure)

    /** Async invocation stopped after its first stage returns. */
    const asyncControl = createSignal()
    /** Async pipeline under one mutable signal. */
    const async = createPipeline<number>({
      mode: MiddlewarePipelineMode.async,
      signal: asyncControl.signal
    })
    await expect(
      async.run(
        [
          () => {
            trace.push('async:first')
            asyncControl.abort()
          },
          () => {
            trace.push('async:second')
          }
        ],
        1,
        () => {
          trace.push('async:done')
        }
      )
    ).rejects.toBe(abortFailure)

    /** Generator invocation stopped after its first iterator terminal result. */
    const generatorControl = createSignal()
    /** Generator pipeline under one mutable signal. */
    const generator = createPipeline<number>({
      mode: MiddlewarePipelineMode.generator,
      signal: generatorControl.signal
    })
    expect(() =>
      generator.run(
        [
          function* (value) {
            trace.push('generator:first')
            generatorControl.abort()
            return value + 1
          },
          function* () {
            trace.push('generator:second')
            return GENERATOR_CONTINUE
          }
        ],
        1,
        () => trace.push('generator:done')
      )
    ).toThrow(abortFailure)

    /** Async-generator invocation stopped after its first iterator terminal result. */
    const asyncGeneratorControl = createSignal()
    /** Async-generator pipeline under one mutable signal. */
    const asyncGenerator = createPipeline<number>({
      mode: MiddlewarePipelineMode.asyncGenerator,
      signal: asyncGeneratorControl.signal
    })
    await expect(
      asyncGenerator.run(
        [
          async function* (value) {
            trace.push('async-generator:first')
            asyncGeneratorControl.abort()
            return value + 1
          },
          async function* () {
            trace.push('async-generator:second')
            return GENERATOR_CONTINUE
          }
        ],
        1,
        () => {
          trace.push('async-generator:done')
        }
      )
    ).rejects.toBe(abortFailure)

    expect(trace).toEqual(['sync:first', 'async:first', 'generator:first', 'async-generator:first'])
  })

  it('A9 passes the effective signal to native and lifted stages in every mode', async () => {
    /** Construction-time signal used by the fallback runs. */
    const creationSignal = new AbortController().signal
    /** Call-time signal that must override construction state. */
    const controlSignal = new AbortController().signal
    /** Captured signal identity from every native and lifted stage. */
    const seen: unknown[] = []

    /** Sync pipeline has no lower source mode to lift. */
    const sync = createPipeline<number>({
      mode: MiddlewarePipelineMode.sync,
      signal: creationSignal
    })
    sync.run([(_value, _next, context) => seen.push(context?.signal)], 1, () => undefined, {
      signal: controlSignal
    })

    /** Async pipeline observes both native and sync-lifted context. */
    const async = createPipeline<number>({
      mode: MiddlewarePipelineMode.async,
      signal: creationSignal
    })
    await async.run(
      [
        (value, next, context) => {
          seen.push(context?.signal)
          return next(value + 1)
        },
        async.lift(
          (_value, _next, context) => seen.push(context?.signal),
          MiddlewarePipelineMode.sync
        )
      ],
      1,
      () => undefined,
      { signal: controlSignal }
    )

    /** Generator pipeline observes both native and sync-lifted context. */
    const generator = createPipeline<number>({
      mode: MiddlewarePipelineMode.generator,
      signal: creationSignal
    })
    generator.run(
      [
        function* (value, context) {
          seen.push(context?.signal)
          return value + 1
        },
        generator.lift(
          (_value, _next, context) => seen.push(context?.signal),
          MiddlewarePipelineMode.sync
        )
      ],
      1,
      () => undefined,
      { signal: controlSignal }
    )

    /** Async-generator pipeline observes both native and sync-lifted context. */
    const asyncGenerator = createPipeline<number>({
      mode: MiddlewarePipelineMode.asyncGenerator,
      signal: creationSignal
    })
    await asyncGenerator.run(
      [
        async function* (value, context) {
          seen.push(context?.signal)
          return value + 1
        },
        asyncGenerator.lift(
          (_value, _next, context) => seen.push(context?.signal),
          MiddlewarePipelineMode.sync
        )
      ],
      1,
      () => undefined,
      { signal: controlSignal }
    )

    expect(seen).toHaveLength(7)
    expect(seen.every((signal) => signal === controlSignal)).toBe(true)

    /** Fallback capture proves construction signal is used without call control. */
    const fallbackSeen: unknown[] = []
    sync.run([(_value, _next, context) => fallbackSeen.push(context?.signal)], 1, () => undefined)
    await async.run(
      [
        (_value, _next, context) => {
          fallbackSeen.push(context?.signal)
        }
      ],
      1,
      () => undefined
    )
    generator.run(
      [
        function* (_value, context) {
          fallbackSeen.push(context?.signal)
          return GENERATOR_HALT
        }
      ],
      1,
      () => undefined
    )
    await asyncGenerator.run(
      [
        async function* (_value, context) {
          fallbackSeen.push(context?.signal)
          return GENERATOR_HALT
        }
      ],
      1,
      () => undefined
    )
    expect(fallbackSeen).toHaveLength(4)
    expect(fallbackSeen.every((signal) => signal === creationSignal)).toBe(true)
  })
})
