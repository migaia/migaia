import { describe, expect, it } from 'vitest'
import {
  createPipeline,
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  MiddlewarePipelineErrorCode,
  MIDDLEWARE_PIPELINE_SOURCE,
  type IAsyncMiddlewareStage,
  type ISyncMiddlewareStage
} from '../src/index.js'

describe('multiple downstream submissions', () => {
  it('keeps frozen own runner functions callable after destructuring', () => {
    /** The named runtime owner must preserve the factory's existing callable own surface. */
    const pipeline = createPipeline<number>({ mode: 'sync' })
    /** Detached calls retain the construction options without a caller-provided receiver. */
    const { run, lift } = pipeline
    /** One ordinary single-mode stage proves detached lifting and execution. */
    const stage: ISyncMiddlewareStage<number> = (value, next) => {
      next(value + 1)
    }
    /** Terminal delivery remains the public result channel. */
    const completed: number[] = []
    run([lift(stage, 'sync')], 1, (value) => {
      completed.push(value)
    })
    expect(completed).toEqual([2])
    expect(Object.keys(pipeline)).toEqual(['mode', 'lift', 'run'])
    expect(Object.isFrozen(pipeline)).toBe(true)
  })
  it('rejects an explicitly null next policy instead of selecting the default', () => {
    expect(() => createPipeline({ mode: 'sync', next: null as never })).toThrowError(TypeError)
    try {
      createPipeline({ mode: 'sync', next: null as never })
    } catch (error) {
      expect(error).toMatchObject({
        source: MIDDLEWARE_PIPELINE_SOURCE,
        code: MiddlewarePipelineErrorCode.invalidOption
      })
    }
  })

  it('retains an earlier business failure when a later started branch observes cancellation', async () => {
    /** An ordinary downstream failure must not disappear behind a later active-control failure. */
    const businessError = new Error('business failure')
    /** Exact cooperative abort reason remains the second original aggregate entry. */
    const abortError = new Error('later cancellation')
    /** The stage cancels only after accepting its first branch. */
    const controller = new AbortController()
    await expect(
      createPipeline<number>({ mode: 'async', next: 'multiple', signal: controller.signal }).run(
        [
          async (_value, next) => {
            /** The first traversal fails before cancellation, but remains independently observed. */
            const first = next(1)
            controller.abort(abortError)
            /** The already-admitted second traversal fails at its own cancellation checkpoint. */
            const second = next(2)
            await Promise.allSettled([first, second])
          }
        ],
        0,
        () => {
          throw businessError
        }
      )
    ).rejects.toMatchObject({
      code: 'MULTIPLE_DOWNSTREAM_FAILED',
      errors: [businessError, abortError]
    })
  })
  it('single guards a reentrant captured next before entering its downstream stage', async () => {
    /** Downstream retains the upstream continuation to exercise synchronous reentry. */
    let upstream!: (value: number) => Promise<void>
    /** One reentry is enough to expose admission published after downstream entry. */
    let reentered = false
    /** Duplicate reporting remains the original single policy. */
    const violations: string[] = []
    /** A rejected reentrant submission must never reach the terminal. */
    const completed: number[] = []
    await createPipeline<number>({
      mode: 'async',
      onViolation: (kind) => {
        violations.push(kind)
      }
    }).run(
      [
        (_value, next) => {
          upstream = next
          return next(1)
        },
        async (value, next) => {
          if (!reentered) {
            reentered = true
            await upstream(2)
          }
          await next(value)
        }
      ],
      0,
      (value) => {
        completed.push(value)
      }
    )
    expect(completed).toEqual([1])
    expect(violations).toEqual(['duplicate'])
  })

  it('multiple keeps original submission order when downstream reenters an upstream next', async () => {
    /** Reentrant submission two must remain behind the already-started submission one. */
    let upstream!: (value: number) => Promise<void>
    /** Failure identities reveal the order chosen by the branch admission owner. */
    const first = new Error('original submission')
    /** Reentrant submission may fail first without changing aggregate order. */
    const second = new Error('reentrant submission')
    await expect(
      createPipeline<number>({ mode: 'async', next: 'multiple' }).run(
        [
          (_value, next) => {
            upstream = next
            return next(1)
          },
          (value, next) => {
            if (value === 1) void upstream(2)
            return next(value)
          }
        ],
        0,
        (value) => {
          throw value === 1 ? first : second
        }
      )
    ).rejects.toMatchObject({
      code: 'MULTIPLE_DOWNSTREAM_FAILED',
      errors: [first, second]
    })
  })

  it('does not count a Promise.all propagated branch error as an independent stage failure', async () => {
    /** Promise.all propagates this exact branch error through the submitting stage. */
    const first = new Error('first concurrent failure')
    /** The second started branch must still be awaited and retained once. */
    const second = new Error('second concurrent failure')
    await expect(
      createPipeline<number>({ mode: 'async', next: 'multiple' }).run(
        [
          async (_value, next) => {
            await Promise.all([next(1), next(2)])
          }
        ],
        0,
        (value) => {
          throw value === 1 ? first : second
        }
      )
    ).rejects.toMatchObject({
      code: 'MULTIPLE_DOWNSTREAM_FAILED',
      errors: [first, second]
    })
  })
  it('sync traverses every submitted value after the submitting stage returns', () => {
    /** Interleaving proves local submission and one terminal per traversal. */
    const events: Array<number | string> = []
    createPipeline<number>({ mode: 'sync', next: 'multiple' }).run(
      [
        (_value, next) => {
          next(1)
          next(2)
          next(3)
          events.push('returned')
        },
        (value, next) => {
          events.push(value)
          next(value)
        }
      ],
      0,
      (value) => {
        events.push(`done:${value}`)
      }
    )
    expect(events).toEqual(['returned', 1, 'done:1', 2, 'done:2', 3, 'done:3'])
  })

  it('sync stops remaining submissions after the second traversal fails', () => {
    /** The original downstream failure must escape without a replacement shell. */
    const failure = new Error('second traversal')
    /** Only the first traversal can reach the terminal. */
    const completed: number[] = []
    expect(() =>
      createPipeline<number>({ mode: 'sync', next: 'multiple' }).run(
        [
          (_value, next) => {
            next(1)
            next(2)
            next(3)
          },
          (value, next) => {
            if (value === 2) throw failure
            next(value)
          }
        ],
        0,
        (value) => {
          completed.push(value)
        }
      )
    ).toThrow(failure)
    expect(completed).toEqual([1])
  })

  it('async starts each traversal immediately and awaits every started traversal', async () => {
    /** Completion is held independently of the submitting stage. */
    let release!: () => void
    /** First traversal remains pending while later traversal starts. */
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Observations establish entry order and final settlement. */
    const received: number[] = []
    /** Completion flag proves unawaited next is still runner-owned. */
    let settled = false
    /** Reusable public runner owns three concurrent branches. */
    const task = createPipeline<number>({ mode: 'async', next: 'multiple' })
      .run(
        [
          (_value, next) => {
            void next(1)
            void next(2)
            void next(3)
          },
          async (value, next) => {
            received.push(value)
            if (value === 1) await barrier
            await next(value)
          }
        ],
        0,
        () => undefined
      )
      .then(() => {
        settled = true
      })
    expect(received).toEqual([1, 2, 3])
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await task
    expect(settled).toBe(true)
  })

  it('async preserves submission order when downstream failures settle in reverse', async () => {
    /** Independently rejected branches retain their exact Error identities. */
    const first = new Error('first branch')
    /** Second failure settles before the first branch. */
    const second = new Error('second branch')
    /** The first branch is released only after the second starts. */
    let rejectFirst!: (error: unknown) => void
    /** Independent branch promise forces reverse settlement. */
    const pending = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    /** Terminal failures are observed even when stages do not await next. */
    const task = createPipeline<number>({ mode: 'async', next: 'multiple' }).run(
      [
        (_value, next) => {
          void next(1)
          void next(2)
        }
      ],
      0,
      (value) => (value === 1 ? pending : Promise.reject(second))
    )
    rejectFirst(first)
    await expect(task).rejects.toMatchObject({
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: 'MULTIPLE_DOWNSTREAM_FAILED',
      errors: [first, second]
    })
  })

  it('async rejects later next calls with the first failure without entering downstream', async () => {
    /** The exact first failure also rejects later submissions. */
    const failure = new Error('failed branch')
    /** Entry count proves later submissions never start. */
    const received: number[] = []
    await expect(
      createPipeline<number>({ mode: 'async', next: 'multiple' }).run(
        [
          async (_value, next) => {
            await expect(next(1)).rejects.toBe(failure)
            await expect(next(2)).rejects.toBe(failure)
          }
        ],
        0,
        (value) => {
          received.push(value)
          throw failure
        }
      )
    ).rejects.toBe(failure)
    expect(received).toEqual([1])
  })

  it('generator traverses each yield before resuming and traverses its ordinary return', () => {
    /** Yield/resume order distinguishes multiple from the old terminal reduction. */
    const events: Array<number | string> = []
    createPipeline<number>({ mode: 'generator', next: 'multiple' }).run(
      [
        function* () {
          yield 1
          events.push('resumed')
          yield 2
          return 3
        },
        function* (value) {
          events.push(value)
          return value
        }
      ],
      0,
      (value) => {
        events.push(`done:${value}`)
      }
    )
    expect(events).toEqual([1, 'done:1', 'resumed', 2, 'done:2', 3, 'done:3'])
  })

  it('generator continue and halt do not add a terminal traversal', () => {
    /** Both control returns stop this generator from adding another payload. */
    for (const signal of [GENERATOR_CONTINUE, GENERATOR_HALT] as const) {
      /** Only explicit yields reach the terminal. */
      const completed: number[] = []
      createPipeline<number>({ mode: 'generator', next: 'multiple' }).run(
        [
          function* (): Generator<number, typeof GENERATOR_CONTINUE | typeof GENERATOR_HALT, void> {
            yield 1
            return signal
          }
        ],
        0,
        (value) => {
          completed.push(value)
        }
      )
      expect(completed).toEqual([1])
    }
  })

  it('generator closes after a failed traversal and forwards explicit undefined', () => {
    /** The original error remains primary when downstream rejects a yield. */
    const failure = new Error('yield failure')
    /** Finally proves the stopped generator is closed. */
    let cleaned = false
    expect(() =>
      createPipeline<number>({ mode: 'generator', next: 'multiple' }).run(
        [
          function* () {
            try {
              yield 1
              yield 2
              yield 3
            } finally {
              cleaned = true
            }
            return GENERATOR_CONTINUE
          },
          function* (value) {
            if (value === 2) throw failure
            return value
          }
        ],
        0,
        () => undefined
      )
    ).toThrow(failure)
    expect(cleaned).toBe(true)
    /** Explicit sentinel reaches downstream once as undefined. */
    const values: Array<number | undefined> = []
    createPipeline<number | undefined>({ mode: 'generator', next: 'multiple' }).run(
      [
        function* () {
          yield GENERATOR_UNDEFINED
          return GENERATOR_CONTINUE
        }
      ],
      0,
      (value) => {
        values.push(value)
      }
    )
    expect(values).toEqual([undefined])
  })

  it('async-generator awaits each traversal before resuming', async () => {
    /** Awaited yield transitions serialize downstream completion. */
    const events: Array<number | string> = []
    await createPipeline<number>({ mode: 'async-generator', next: 'multiple' }).run(
      [
        async function* () {
          yield 1
          events.push('resumed')
          yield 2
          return 3
        },
        async function* (value) {
          events.push(value)
          return value
        }
      ],
      0,
      async (value) => {
        await Promise.resolve()
        events.push(`done:${value}`)
      }
    )
    expect(events).toEqual([1, 'done:1', 'resumed', 2, 'done:2', 3, 'done:3'])
  })

  it('async-generator closes after its second traversal fails without starting the third', async () => {
    /** Cleanup retains the original traversal error and stops future yielded values. */
    const failure = new Error('async yield failure')
    /** Terminal observations show the third value never enters the suffix. */
    const completed: number[] = []
    /** Finally establishes physical iterator cleanup after downstream failure. */
    let cleaned = false
    await expect(
      createPipeline<number>({ mode: 'async-generator', next: 'multiple' }).run(
        [
          async function* () {
            try {
              yield 1
              yield 2
              yield 3
            } finally {
              cleaned = true
            }
            return GENERATOR_CONTINUE
          }
        ],
        0,
        (value) => {
          if (value === 2) throw failure
          completed.push(value)
        }
      )
    ).rejects.toBe(failure)
    expect(completed).toEqual([1])
    expect(cleaned).toBe(true)
  })

  it('async-generator control returns add no traversal and explicit undefined is delivered', async () => {
    /** The control domain is bounded by these two exported sentinel constants. */
    for (const signal of [GENERATOR_CONTINUE, GENERATOR_HALT] as const) {
      /** Only explicit yields publish payloads under either control return. */
      const values: Array<number | undefined> = []
      await createPipeline<number | undefined>({ mode: 'async-generator', next: 'multiple' }).run(
        [
          async function* (): AsyncGenerator<
            number | typeof GENERATOR_UNDEFINED,
            typeof GENERATOR_CONTINUE | typeof GENERATOR_HALT,
            void
          > {
            yield 1
            yield GENERATOR_UNDEFINED
            return signal
          }
        ],
        0,
        (value) => {
          values.push(value)
        }
      )
      expect(values).toEqual([1, undefined])
    }
  })

  it('async waits for awaited submissions in order and does not start the third after failure', async () => {
    /** Sequential next calls expose the first failure before another traversal starts. */
    const failure = new Error('second async traversal')
    /** Only accepted terminal entries are recorded. */
    const entered: number[] = []
    await expect(
      createPipeline<number>({ mode: 'async', next: 'multiple' }).run(
        [
          async (_value, next) => {
            await next(1)
            await next(2)
            await next(3)
          }
        ],
        0,
        (value) => {
          entered.push(value)
          if (value === 2) throw failure
        }
      )
    ).rejects.toBe(failure)
    expect(entered).toEqual([1, 2])
  })

  it('preserves stage failure first when several started downstream traversals also fail', async () => {
    /** Stage and branch failures represent independent original values. */
    const stageFailure = new Error('stage failure')
    /** First branch remains first even though failures are combined at two boundaries. */
    const first = new Error('first downstream')
    /** Second original failure must remain reachable within the downstream aggregate. */
    const second = new Error('second downstream')
    /** The public runner keeps the preexisting stage-and-downstream combination policy. */
    const task = createPipeline<number>({ mode: 'async', next: 'multiple' }).run(
      [
        (_value, next) => {
          void next(1)
          void next(2)
          throw stageFailure
        }
      ],
      0,
      (value) => {
        throw value === 1 ? first : second
      }
    )
    await expect(task).rejects.toMatchObject({
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.executionFailed,
      errors: [stageFailure, { code: 'MULTIPLE_DOWNSTREAM_FAILED', errors: [first, second] }]
    })
  })

  it('checks cancellation before each new sync and async traversal', async () => {
    /** The original abort error must remain the rejection object in both modes. */
    const reason = new Error('cancel later traversal')
    /** Independent controllers keep executions isolated. */
    const syncController = new AbortController()
    /** Only the first accepted branch reaches the terminal before cancellation. */
    const syncValues: number[] = []
    expect(() =>
      createPipeline<number>({ mode: 'sync', next: 'multiple', signal: syncController.signal }).run(
        [
          (_value, next) => {
            next(1)
            next(2)
          }
        ],
        0,
        (value) => {
          syncValues.push(value)
          syncController.abort(reason)
        }
      )
    ).toThrow(reason)
    expect(syncValues).toEqual([1])
    /** Async execution rechecks signal when a stage submits its next branch. */
    const asyncController = new AbortController()
    /** Separate terminal observations establish per-run cancellation isolation. */
    const asyncValues: number[] = []
    await expect(
      createPipeline<number>({
        mode: 'async',
        next: 'multiple',
        signal: asyncController.signal
      }).run(
        [
          async (_value, next) => {
            await next(1)
            await next(2)
          }
        ],
        0,
        (value) => {
          asyncValues.push(value)
          asyncController.abort(reason)
        }
      )
    ).rejects.toBe(reason)
    expect(asyncValues).toEqual([1])
  })

  it('multiple rejects late sync and async submissions without another traversal', async () => {
    /** Late calls remain diagnostics even when multiple calls were allowed while active. */
    const violations: string[] = []
    /** Retained callbacks model a caller using next after its stage settled. */
    let syncNext!: (value: number) => void
    /** Async next must retain its Promise shape after settlement. */
    let asyncNext!: (value: number) => Promise<void>
    /** Only accepted values reach terminal. */
    const completed: number[] = []
    createPipeline<number>({
      mode: 'sync',
      next: 'multiple',
      onViolation: (kind) => {
        violations.push(kind)
      }
    }).run(
      [
        (_value, next) => {
          syncNext = next
          next(1)
        }
      ],
      0,
      (value) => {
        completed.push(value)
      }
    )
    syncNext(2)
    await createPipeline<number>({
      mode: 'async',
      next: 'multiple',
      onViolation: (kind) => {
        violations.push(kind)
      }
    }).run(
      [
        (_value, next) => {
          asyncNext = next
          return next(3)
        }
      ],
      0,
      (value) => {
        completed.push(value)
      }
    )
    await asyncNext(4)
    expect(violations).toEqual(['late', 'late'])
    expect(completed).toEqual([1, 3])
  })

  it('multiple lifting preserves all sync submissions in every compatible mode', async () => {
    /** One sync definition must not lose branches when its host selects another mode. */
    const stage: ISyncMiddlewareStage<number> = (_value, next) => {
      next(1)
      next(2)
      next(3)
    }
    /** Each lifted mode uses its canonical public adapter. */
    for (const mode of ['async', 'generator', 'async-generator'] as const) {
      /** Collected terminal values verify all lifted submissions. */
      const completed: number[] = []
      /** Generic mode stays tied to its stage shape. */
      const pipeline = createPipeline<number, typeof mode>({ mode, next: 'multiple' })
      await pipeline.run([pipeline.lift(stage, 'sync')], 0, (value) => {
        completed.push(value)
      })
      expect(completed).toEqual([1, 2, 3])
    }
  })

  it('rejects an invalid next option synchronously and preserves single defaults', async () => {
    expect(() => createPipeline({ mode: 'sync', next: 'invalid' as never })).toThrowError(TypeError)
    try {
      createPipeline({ mode: 'sync', next: 'invalid' as never })
    } catch (error) {
      expect(error).toMatchObject({
        source: MIDDLEWARE_PIPELINE_SOURCE,
        code: MiddlewarePipelineErrorCode.invalidOption
      })
    }
    /** Explicit single has the same duplicate diagnostic and selected first value. */
    for (const next of [undefined, 'single'] as const) {
      /** Baseline observations stay identical under both construction forms. */
      const values: number[] = []
      /** Duplicate reporting remains the existing default contract. */
      const violations: string[] = []
      /** Existing async single stage always uses its first downstream traversal. */
      const stage: IAsyncMiddlewareStage<number> = async (_value, forward) => {
        await forward(1)
        await forward(2)
      }
      await createPipeline<number>({
        mode: 'async',
        next,
        onViolation: (kind) => {
          violations.push(kind)
        }
      }).run([stage], 0, (value) => {
        values.push(value)
      })
      expect(values).toEqual([1])
      expect(violations).toEqual(['duplicate'])
    }
  })
})
