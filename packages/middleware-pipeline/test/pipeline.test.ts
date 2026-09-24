import { describe, expect, it } from 'vitest'
import {
  GENERATOR_CONTINUE,
  GENERATOR_HALT,
  GENERATOR_UNDEFINED,
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type ISyncMiddlewareStage
} from '../src/index.js'
import {
  liftSyncToAsyncForTest,
  liftSyncToGeneratorForTest,
  runAsyncForTest,
  runGeneratorForTest,
  runSyncForTest
} from './pipeline-test-helpers.js'

/** Minimal process surface used to assert that downstream rejection is owned immediately. */
type IRejectionHost = {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void
}

/**
 * Exercises nested control ownership against independent middle-frame failure for all outer next
 * styles.
 */
const assertNestedControlDoesNotEraseStageError = async (
  guard: 'entry' | 'post-stage'
): Promise<void> => {
  for (const outerStyle of ['void', 'await', 'return'] as const) {
    const activeError = new Error(`host is closing during nested ${guard} ${outerStyle}`)
    const stageError = new Error(`independent middle ${guard} failure ${outerStyle}`)
    const combinations: unknown[][] = []
    let active = true
    const outer: IAsyncMiddlewareStage<number> = async (_value, next) => {
      const downstream = next(2)
      if (outerStyle === 'void') void downstream
      else if (outerStyle === 'await') await downstream
      else return downstream
    }
    const middle: IAsyncMiddlewareStage<number> = async (_value, next) => {
      if (guard === 'entry') active = false
      try {
        await next(3)
      } catch (error) {
        expect(error).toBe(activeError)
      }
      throw stageError
    }
    const inner: IAsyncMiddlewareStage<number> = async () => {
      if (guard === 'post-stage') active = false
    }
    const run = runAsyncForTest([outer, middle, inner], 1, () => undefined, {
      onViolation: () => undefined,
      assertActive: () => {
        if (!active) throw activeError
      },
      combineStageAndDownstreamError: (stageFailure, downstreamFailure) => {
        combinations.push([stageFailure, downstreamFailure])
        return new Error(`combined nested ${guard} ${outerStyle}`)
      }
    })

    if (outerStyle === 'void') {
      await expect(run).rejects.toBe(stageError)
      expect(combinations).toEqual([])
    } else {
      await expect(run).rejects.toThrow(`combined nested ${guard} ${outerStyle}`)
      expect(combinations).toEqual([[stageError, stageError]])
    }
  }
}

/** A3 reuses this unchanged behavior suite through the unified pipeline factory. */
describe('runSyncMiddleware', () => {
  it('snapshots replacement, insertion, and deletion before sync dispatch', () => {
    const stages: Array<ISyncMiddlewareStage<number>> = []
    let originalSecondCalls = 0
    let originalThirdCalls = 0
    let replacementCalls = 0
    let insertedCalls = 0
    const receivers: unknown[] = []
    stages.push(
      (value, next) => {
        stages[1] = (_current, replacementNext) => {
          replacementCalls += 1
          replacementNext(100)
        }
        stages.splice(1, 0, (_current, insertedNext) => {
          insertedCalls += 1
          insertedNext(200)
        })
        stages.splice(3, 1)
        next(value + 1)
      },
      function (this: unknown, value, next) {
        receivers.push(this)
        originalSecondCalls += 1
        next(value + 1)
      },
      function (this: unknown, value, next) {
        receivers.push(this)
        originalThirdCalls += 1
        next(value + 1)
      }
    )
    const values: number[] = []
    runSyncForTest(
      stages,
      1,
      (value) => values.push(value),
      () => {
        throw new Error('unexpected violation')
      }
    )
    expect(values).toEqual([4])
    expect(originalSecondCalls).toBe(1)
    expect(originalThirdCalls).toBe(1)
    expect(replacementCalls).toBe(0)
    expect(insertedCalls).toBe(0)
    expect(receivers).toEqual([undefined, undefined])
  })

  it('short-circuits when a stage does not call next', () => {
    const values: number[] = []
    runSyncForTest(
      [(value) => value],
      1,
      (value) => values.push(value),
      () => undefined
    )
    expect(values).toEqual([])
  })

  it('reports duplicate and late next without changing the first value', () => {
    const violations: string[] = []
    let lateNext!: (value: number) => void
    const values: number[] = []
    runSyncForTest(
      [
        (_value, next) => {
          next(2)
          next(3)
          lateNext = next
        }
      ],
      1,
      (value) => values.push(value),
      (kind) => violations.push(kind)
    )
    lateNext(4)
    expect(values).toEqual([2])
    expect(violations).toEqual(['duplicate', 'late'])
  })
})

describe('runAsyncMiddleware', () => {
  it('enters shallow downstream synchronously while preserving the returned Promise', () => {
    const trace: string[] = []
    const run = runAsyncForTest(
      [
        (value, next) => {
          trace.push(`outer:${value}`)
          const pending = next(value + 1)
          trace.push('outer-after-next')
          return pending
        },
        (value, next) => {
          trace.push(`inner:${value}`)
          return next(value + 1)
        }
      ],
      1,
      (value) => {
        trace.push(`done:${value}`)
      },
      { onViolation: () => undefined }
    )
    expect(trace).toEqual(['outer:1', 'inner:2', 'done:3', 'outer-after-next'])
    return run.then(() =>
      expect(trace).toEqual(['outer:1', 'inner:2', 'done:3', 'outer-after-next'])
    )
  })

  it('uses a synchronous package-owned spill to keep deep chains stack safe', async () => {
    const stages: Array<IAsyncMiddlewareStage<number>> = Array.from(
      { length: 2000 },
      () => (value, next) => next(value + 1)
    )
    let result = 0
    await runAsyncForTest(
      stages,
      0,
      (value) => {
        result = value
      },
      { onViolation: () => undefined }
    )
    expect(result).toBe(2000)
  })

  it('observes downstream rejection while upstream stage remains pending', async () => {
    /** Releases upstream stage after rejection observation window. */
    let releaseUpstream!: () => void
    /** Signals downstream rejection has been scheduled. */
    let resolveDownstreamStarted!: () => void
    /** Gate held by upstream stage after it starts downstream. */
    const upstreamGate = new Promise<void>((resolve) => {
      releaseUpstream = resolve
    })
    /** Resolves when downstream has reached its rejection path. */
    const downstreamStarted = new Promise<void>((resolve) => {
      resolveDownstreamStarted = resolve
    })
    /** Host-level rejection listener used to detect detached downstream failure. */
    const rejectionHost = (globalThis as { process: IRejectionHost }).process
    /** Records any unhandled rejection emitted before upstream gate release. */
    const unhandled: unknown[] = []
    /** Captures host rejection notifications for this regression case. */
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const downstreamError = new Error('downstream exact failure')
    rejectionHost.on('unhandledRejection', onUnhandled)
    try {
      const run = runAsyncForTest(
        [
          async (_value, next) => {
            void next(2)
            await upstreamGate
          },
          async () => {
            resolveDownstreamStarted()
            throw downstreamError
          }
        ],
        1,
        () => undefined,
        { onViolation: () => undefined }
      )
      await downstreamStarted
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      expect(unhandled).toEqual([])
      releaseUpstream()
      await expect(run).rejects.toBe(downstreamError)
    } finally {
      rejectionHost.off('unhandledRejection', onUnhandled)
    }
  })

  it('snapshots replacement, insertion, and deletion while downstream awaits', async () => {
    const stages: Array<IAsyncMiddlewareStage<number>> = []
    let releaseDownstream!: () => void
    let downstreamStarted!: () => void
    const downstreamReady = new Promise<void>((resolve) => {
      downstreamStarted = resolve
    })
    const downstreamGate = new Promise<void>((resolve) => {
      releaseDownstream = resolve
    })
    let originalThirdCalls = 0
    let replacementCalls = 0
    let insertedCalls = 0
    stages.push(
      async (value, next) => {
        await next(value + 1)
      },
      async (value, next) => {
        downstreamStarted()
        await downstreamGate
        await next(value + 1)
      },
      async (value, next) => {
        originalThirdCalls += 1
        await next(value + 1)
      }
    )

    let result = 0
    const run = runAsyncForTest(
      stages,
      1,
      (value) => {
        result = value
      },
      { onViolation: () => undefined }
    )
    await downstreamReady
    stages[2] = async (_value, next) => {
      replacementCalls += 1
      await next(100)
    }
    stages.splice(2, 0, async (_value, next) => {
      insertedCalls += 1
      await next(200)
    })
    stages.pop()
    releaseDownstream()
    await run

    expect(result).toBe(4)
    expect(originalThirdCalls).toBe(1)
    expect(replacementCalls).toBe(0)
    expect(insertedCalls).toBe(0)
  })

  it('handles long next chains without overflowing the call stack', async () => {
    const stages = Array.from(
      { length: 20000 },
      () => (value: number, next: (nextValue: number) => Promise<void>) => next(value + 1)
    )
    let result = 0
    await runAsyncForTest(
      stages,
      0,
      (value) => {
        result = value
      },
      { onViolation: () => undefined }
    )
    expect(result).toBe(20000)
  })

  it('combines upstream and downstream failures through the injected policy', async () => {
    const combinations: unknown[][] = []
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            void next(2)
            throw new Error('upstream')
          },
          async () => {
            throw new Error('downstream')
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          combineStageAndDownstreamError: (stageError, downstreamError) => {
            combinations.push([stageError, downstreamError])
            return new Error('combined')
          }
        }
      )
    ).rejects.toThrow('combined')
    expect(combinations).toHaveLength(1)
    expect(combinations[0]).toEqual([
      expect.objectContaining({ message: 'upstream' }),
      expect.objectContaining({ message: 'downstream' })
    ])
  })

  it.each(['await', 'return'] as const)(
    'combines stage and downstream channels for %s next() with the same Error',
    async (style) => {
      const sharedError = new Error(`same ${style} failure`)
      const combinations: unknown[][] = []
      const stage: IAsyncMiddlewareStage<number> = async (_value, next) => {
        const result = next(2)
        if (style === 'await') {
          await result
        } else {
          return result
        }
      }
      await expect(
        runAsyncForTest([stage, async () => Promise.reject(sharedError)], 1, () => undefined, {
          onViolation: () => undefined,
          combineStageAndDownstreamError: (stageError, downstreamError) => {
            combinations.push([stageError, downstreamError])
            return new Error('combined same failure')
          }
        })
      ).rejects.toThrow('combined same failure')
      expect(combinations).toEqual([[sharedError, sharedError]])
    }
  )

  it('combines an independently thrown stage error after downstream rejection is handled', async () => {
    const stageError = new Error('independent stage failure')
    const downstreamError = new Error('handled downstream failure')
    const combinations: unknown[][] = []
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            await next(2).catch(() => undefined)
            throw stageError
          },
          async () => Promise.reject(downstreamError)
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          combineStageAndDownstreamError: (stage, downstream) => {
            combinations.push([stage, downstream])
            return new Error('combined handled downstream')
          }
        }
      )
    ).rejects.toThrow('combined handled downstream')
    expect(combinations).toEqual([[stageError, downstreamError]])
  })

  it.each(['then', 'catch', 'finally'] as const)(
    'combines failures after using borrowed native Promise.prototype.%s',
    async (method) => {
      const sharedError = new Error(`borrowed ${method} failure`)
      const combinations: unknown[][] = []
      const stage: IAsyncMiddlewareStage<number> = async (_value, next) => {
        const result = next(2)
        expect(result).toBeInstanceOf(Promise)
        const rethrow = (error: unknown): never => {
          throw error
        }
        if (method === 'then') {
          // oxlint-disable-next-line unicorn/no-thenable -- test borrowed native Promise method behavior.
          Object.defineProperty(result, 'then', { value: Promise.prototype.then })
          return result.then(undefined, rethrow)
        }
        if (method === 'catch') {
          Object.defineProperty(result, 'catch', { value: Promise.prototype.catch })
          return result.catch(rethrow)
        }
        Object.defineProperty(result, 'finally', { value: Promise.prototype.finally })
        return result.finally(() => undefined)
      }
      await expect(
        runAsyncForTest([stage, async () => Promise.reject(sharedError)], 1, () => undefined, {
          onViolation: () => undefined,
          combineStageAndDownstreamError: (stageError, downstreamError) => {
            combinations.push([stageError, downstreamError])
            return new Error('combined borrowed failure')
          }
        })
      ).rejects.toThrow('combined borrowed failure')
      expect(combinations).toEqual([[sharedError, sharedError]])
    }
  )

  it('keeps dual-error semantics deterministic when next() constructor is mutated', async () => {
    const sharedError = new Error('mutated constructor failure')
    const combinations: unknown[][] = []
    const stage: IAsyncMiddlewareStage<number> = async (_value, next) => {
      const result = next(2)
      Object.defineProperty(result, 'constructor', {
        configurable: true,
        value: function MutatedPromiseConstructor() {}
      })
      return result
    }
    await expect(
      runAsyncForTest([stage, async () => Promise.reject(sharedError)], 1, () => undefined, {
        onViolation: () => undefined,
        combineStageAndDownstreamError: (stageError, downstreamError) => {
          combinations.push([stageError, downstreamError])
          return new Error('combined mutated constructor failure')
        }
      })
    ).rejects.toThrow('combined mutated constructor failure')
    expect(combinations).toEqual([[sharedError, sharedError]])
  })

  it.each([undefined, null])('throws explicit nullish combiner result: %s', async (result) => {
    const stageError = new Error('stage failure')
    const downstreamError = new Error('downstream failure')
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            void next(2)
            throw stageError
          },
          async () => {
            throw downstreamError
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          combineStageAndDownstreamError: () => result
        }
      )
    ).rejects.toEqual(result)
  })

  it('combines independent post-next stage and downstream failures in stage-first order', async () => {
    const stageError = new Error('post-next stage')
    const downstreamError = new Error('independent downstream')
    const combinations: unknown[][] = []
    const stage = async (_value: number, next: (value: number) => Promise<void>) => {
      void next(2)
      throw stageError
    }
    await expect(
      runAsyncForTest([stage, async () => Promise.reject(downstreamError)], 1, () => undefined, {
        onViolation: () => undefined,
        combineStageAndDownstreamError: (upstream, downstream) => {
          combinations.push([upstream, downstream])
          return new Error('combined independent')
        }
      })
    ).rejects.toThrow('combined independent')
    expect(combinations).toEqual([[stageError, downstreamError]])
  })

  it('combines independent equal primitive failures instead of deduplicating by value', async () => {
    const combinations: unknown[][] = []
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            void next(2)
            throw undefined
          },
          async () => Promise.reject(undefined)
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          combineStageAndDownstreamError: (stageError, downstreamError) => {
            combinations.push([stageError, downstreamError])
            return new Error('combined primitive failures')
          }
        }
      )
    ).rejects.toThrow('combined primitive failures')
    expect(combinations).toEqual([[undefined, undefined]])
  })

  it('reports duplicate and late async next without starting downstream twice', async () => {
    const violations: string[] = []
    let downstreamRuns = 0
    let lateNext!: (value: number) => Promise<void>
    await runAsyncForTest(
      [
        async (value, next) => {
          lateNext = next
          await next(value + 1)
          await next(value + 2)
        },
        async () => {
          downstreamRuns += 1
        }
      ],
      1,
      () => undefined,
      { onViolation: (kind) => violations.push(kind) }
    )
    await lateNext(4)
    expect(downstreamRuns).toBe(1)
    expect(violations).toEqual(['duplicate', 'late'])
  })

  it('codes the default aggregate while preserving both original failures', async () => {
    const stageError = new Error('default upstream')
    const downstreamError = new Error('default downstream')
    const rejected = runAsyncForTest(
      [
        async (_value, next) => {
          void next(2)
          throw stageError
        },
        async () => {
          throw downstreamError
        }
      ],
      1,
      () => undefined,
      { onViolation: () => undefined }
    )
    await expect(rejected).rejects.toMatchObject({
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.executionFailed,
      message: 'middleware stage and downstream failed',
      errors: [stageError, downstreamError]
    })
    await expect(rejected).rejects.toBeInstanceOf(AggregateError)
    await expect(rejected).rejects.toSatisfy((error: unknown) => {
      const value = error as AggregateError & { readonly stack?: string }
      return value.stack !== undefined && value.stack.length > 0
    })
  })

  it('preserves undefined throws and rejections as failures', async () => {
    await expect(
      runAsyncForTest(
        [
          async () => {
            throw undefined
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined
        }
      )
    ).rejects.toBeUndefined()
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            void next(2)
          },
          async () => Promise.reject(undefined)
        ],
        1,
        () => undefined,
        { onViolation: () => undefined }
      )
    ).rejects.toBeUndefined()
  })

  it('throws exact stage failure before a closing active check', async () => {
    const stageError = new Error('stage failed while closing')
    const activeError = new Error('host is closing')
    let active = true
    await expect(
      runAsyncForTest(
        [
          async () => {
            active = false
            throw stageError
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          assertActive: () => {
            if (!active) throw activeError
          }
        }
      )
    ).rejects.toBe(stageError)
  })

  it('throws exact downstream failure before a closing active check', async () => {
    const downstreamError = new Error('downstream failed while closing')
    const activeError = new Error('host is closing')
    let active = true
    let activeChecks = 0
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            active = false
            void next(2)
          },
          async () => {
            throw downstreamError
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          assertActive: () => {
            activeChecks += 1
            if (activeChecks > 2 && !active) throw activeError
          }
        }
      )
    ).rejects.toBe(downstreamError)
  })

  it('combines dual failures before a closing active check in stage-first order', async () => {
    const stageError = new Error('stage failed while closing')
    const downstreamError = new Error('downstream failed while closing')
    const activeError = new Error('host is closing')
    const combinations: unknown[][] = []
    let active = true
    let activeChecks = 0
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            active = false
            void next(2)
            throw stageError
          },
          async () => {
            throw downstreamError
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          assertActive: () => {
            activeChecks += 1
            if (activeChecks > 2 && !active) throw activeError
          },
          combineStageAndDownstreamError: (stage, downstream) => {
            combinations.push([stage, downstream])
            return new Error('combined while closing')
          }
        }
      )
    ).rejects.toThrow('combined while closing')
    expect(combinations).toEqual([[stageError, downstreamError]])
  })

  it('applies the closing active check after successful incomplete dispatch', async () => {
    const activeError = new Error('host is closing')
    let active = true
    await expect(
      runAsyncForTest(
        [
          async () => {
            active = false
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          assertActive: () => {
            if (!active) throw activeError
          }
        }
      )
    ).rejects.toBe(activeError)
  })

  it.each(['await', 'return'] as const)(
    'does not duplicate runner-owned post-stage active failure for %s next()',
    async (style) => {
      const activeError = new Error(`host is closing after ${style}`)
      const combinations: unknown[][] = []
      let active = true
      const stage: IAsyncMiddlewareStage<number> = async (_value, next) => {
        const downstream = next(2)
        if (style === 'await') await downstream
        else return downstream
      }
      await expect(
        runAsyncForTest(
          [
            stage,
            async () => {
              active = false
            }
          ],
          1,
          () => undefined,
          {
            onViolation: () => undefined,
            assertActive: () => {
              if (!active) throw activeError
            },
            combineStageAndDownstreamError: (stageError, downstreamError) => {
              combinations.push([stageError, downstreamError])
              return new Error('unexpected active-error combination')
            }
          }
        )
      ).rejects.toBe(activeError)
      expect(combinations).toEqual([])
      if (style === 'await') {
        // MP-T37: nested post-stage control must not erase an independent middle stage error.
        await assertNestedControlDoesNotEraseStageError('post-stage')
      }
    }
  )

  it.each(['await', 'return'] as const)(
    'does not duplicate runner-owned entry active failure for %s next()',
    async (style) => {
      const activeError = new Error(`host is closing before entry ${style}`)
      const combinations: unknown[][] = []
      let active = true
      const stage: IAsyncMiddlewareStage<number> = async (_value, next) => {
        const downstream = next(2)
        active = false
        if (style === 'await') await downstream
        else return downstream
      }
      const pipelineFailed = {
        source: '@migaia/plugin-host',
        code: 'PIPELINE_FAILED'
      }
      await expect(
        runAsyncForTest([stage, async () => undefined], 1, () => undefined, {
          onViolation: () => undefined,
          assertActive: () => {
            if (!active) throw activeError
          },
          combineStageAndDownstreamError: (stageError, downstreamError) => {
            combinations.push([stageError, downstreamError])
            return pipelineFailed
          }
        })
      ).rejects.toBe(activeError)
      expect(combinations).toEqual([])
      if (style === 'await') {
        // MP-T36: nested entry control must not erase an independent middle stage error.
        await assertNestedControlDoesNotEraseStageError('entry')
      }
    }
  )

  it('propagates entry active control through nested next frames without combining it', async () => {
    const activeError = new Error('host is closing before nested entry')
    const combinations: unknown[][] = []
    let active = true
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            await next(2)
          },
          async (_value, next) => {
            const downstream = next(3)
            active = false
            await downstream
          },
          async () => undefined
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          assertActive: () => {
            if (!active) throw activeError
          },
          combineStageAndDownstreamError: (stageError, downstreamError) => {
            combinations.push([stageError, downstreamError])
            return new Error('unexpected nested active-error combination')
          }
        }
      )
    ).rejects.toBe(activeError)
    expect(combinations).toEqual([])
  })

  it('preserves an independent stage failure beside post-stage active control', async () => {
    const stageError = new Error('independent stage failure')
    const activeError = new Error('host is closing after downstream')
    const combinations: unknown[][] = []
    let active = true
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            void next(2)
            throw stageError
          },
          async () => {
            active = false
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          assertActive: () => {
            if (!active) throw activeError
          },
          combineStageAndDownstreamError: (stageFailure, downstreamFailure) => {
            combinations.push([stageFailure, downstreamFailure])
            return new Error('unexpected independent active combination')
          }
        }
      )
    ).rejects.toBe(stageError)
    expect(combinations).toEqual([])
  })

  it('does not check active after done completes the dispatch', async () => {
    const activeError = new Error('host is closing')
    let active = true
    let doneCalled = false
    await expect(
      runAsyncForTest(
        [async (value, next) => next(value + 1)],
        1,
        () => {
          doneCalled = true
          active = false
        },
        {
          onViolation: () => undefined,
          assertActive: () => {
            if (!active) throw activeError
          }
        }
      )
    ).resolves.toBeUndefined()
    expect(doneCalled).toBe(true)
  })

  it('supports active checks after downstream completion', async () => {
    let active = true
    const activeError = new Error('inactive')
    await expect(
      runAsyncForTest(
        [
          async (_value) => {
            active = false
          }
        ],
        1,
        () => undefined,
        {
          onViolation: () => undefined,
          assertActive: () => {
            if (!active) throw activeError
          }
        }
      )
    ).rejects.toBe(activeError)
  })

  it('runs the completion callback for an empty stage list', async () => {
    const values: number[] = []
    await runAsyncForTest(
      [],
      3,
      (value) => {
        values.push(value)
      },
      { onViolation: () => undefined }
    )
    expect(values).toEqual([3])
  })
})

describe('adaptSyncStageToAsync', () => {
  it('reports duplicate next and starts only the first downstream', async () => {
    const violations: string[] = []
    let downstreamRuns = 0
    const adapted = liftSyncToAsyncForTest(
      (_, next: (value: number) => void) => {
        next(2)
        next(3)
      },
      (kind) => violations.push(kind)
    )
    await adapted(1, () => {
      downstreamRuns += 1
      return Promise.resolve()
    })
    expect(violations).toEqual(['duplicate'])
    expect(downstreamRuns).toBe(1)
  })

  it('reports late next after the stage returns', async () => {
    const violations: string[] = []
    let storedNext!: (value: number) => void
    let downstreamRuns = 0
    const adapted = liftSyncToAsyncForTest(
      (_value, next: (value: number) => void) => {
        storedNext = next
      },
      (kind) => violations.push(kind)
    )
    const pending = adapted(1, () => {
      downstreamRuns += 1
      return Promise.resolve()
    })
    storedNext(2)
    await pending
    expect(violations).toEqual(['late'])
    expect(downstreamRuns).toBe(0)
  })

  it('observes the first downstream rejection', async () => {
    const adapted = liftSyncToAsyncForTest((_value, next: (value: number) => void) => {
      next(2)
      next(3)
    })
    await expect(adapted(1, () => Promise.reject(new Error('downstream boom')))).rejects.toThrow(
      'downstream boom'
    )
  })
})

describe('adaptSyncStageToGenerator', () => {
  it('converts next into a yielded value and reports duplicate/late calls', () => {
    const violations: string[] = []
    let lateNext!: (value: number) => void
    const adapted = liftSyncToGeneratorForTest(
      (_value, next) => {
        lateNext = next
        next(2)
        next(3)
      },
      (kind) => violations.push(kind)
    )
    const iterator = adapted(1)
    expect(iterator.next()).toEqual({ value: 2, done: false })
    expect(iterator.next()).toEqual({ value: GENERATOR_CONTINUE, done: true })
    lateNext(4)
    expect(violations).toEqual(['duplicate', 'late'])
  })
})

describe('runGeneratorMiddleware', () => {
  it('snapshots replacement, insertion, and deletion before generator dispatch', () => {
    const stages: Array<IGeneratorMiddlewareStage<number>> = []
    let originalSecondCalls = 0
    let originalThirdCalls = 0
    let replacementCalls = 0
    let insertedCalls = 0
    stages.push(
      function* (value) {
        stages[1] = function* () {
          replacementCalls += 1
          return 100
        }
        stages.splice(1, 0, function* () {
          insertedCalls += 1
          return 200
        })
        stages.splice(3, 1)
        yield value + 1
        return GENERATOR_CONTINUE
      },
      function* (value) {
        originalSecondCalls += 1
        yield value + 1
        return GENERATOR_CONTINUE
      },
      function* (value) {
        originalThirdCalls += 1
        yield value + 1
        return GENERATOR_CONTINUE
      }
    )
    const values: number[] = []

    runGeneratorForTest(stages, 1, (value) => values.push(value))

    expect(values).toEqual([4])
    expect(originalSecondCalls).toBe(1)
    expect(originalThirdCalls).toBe(1)
    expect(replacementCalls).toBe(0)
    expect(insertedCalls).toBe(0)
  })

  it('uses final return value and last yield fallback', () => {
    const values: number[] = []
    runGeneratorForTest<number>(
      [
        function* (value) {
          yield value + 1
          return value + 2
        },
        function* (value) {
          yield value * 2
          return GENERATOR_CONTINUE
        }
      ],
      1,
      (value) => values.push(value)
    )
    expect(values).toEqual([6])
  })

  it('supports explicit undefined and halt after yielding', () => {
    const undefinedValues: unknown[] = []
    runGeneratorForTest<string | undefined>(
      [
        function* () {
          return GENERATOR_UNDEFINED
        }
      ],
      'input',
      (value) => undefinedValues.push(value)
    )
    expect(undefinedValues).toEqual([undefined])
    const halted: number[] = []
    runGeneratorForTest(
      [
        function* () {
          yield 2
          return GENERATOR_HALT
        }
      ],
      1,
      (value) => halted.push(value)
    )
    expect(halted).toEqual([])
  })

  it('accepts host-owned sentinel identities for compatibility wrappers', () => {
    const hostContinue = Symbol('host.continue')
    const values: number[] = []
    runGeneratorForTest(
      [
        function* (value) {
          yield value + 1
          return hostContinue as unknown as typeof GENERATOR_CONTINUE
        }
      ],
      1,
      (value) => values.push(value),
      {
        undefined: Symbol('host.undefined'),
        halt: Symbol('host.halt'),
        continue: hostContinue
      }
    )
    expect(values).toEqual([2])
  })
})
it('standalone adapter observes downstream failure but preserves stage error identity', async () => {
  const stage = new Error('stage')
  const downstream = new Error('downstream')
  await expect(
    liftSyncToAsyncForTest((value, next) => {
      next(value)
      throw stage
    })(1, async () => Promise.reject(downstream))
  ).rejects.toBe(stage)
})

it('runner combines adapted stage and downstream failures exactly once', async () => {
  const stage = new Error('stage')
  const downstream = new Error('downstream')
  const combinations: unknown[][] = []
  const adapted = liftSyncToAsyncForTest((value, next) => {
    next(value)
    throw stage
  })
  const combined = new Error('combined')
  await expect(
    runAsyncForTest(
      [adapted],
      1,
      () => {
        throw downstream
      },
      {
        onViolation: () => undefined,
        combineStageAndDownstreamError: (stageError, downstreamError) => {
          combinations.push([stageError, downstreamError])
          return combined
        }
      }
    )
  ).rejects.toBe(combined)
  expect(combinations).toEqual([[stage, downstream]])
})
