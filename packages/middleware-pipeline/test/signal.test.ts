import { describe, expect, it, vi } from 'vitest'
import { GENERATOR_CONTINUE } from '../src/index.js'
import {
  runAsyncForTest,
  runAsyncGeneratorForTest,
  runGeneratorForTest,
  runSyncForTest
} from './pipeline-test-helpers.js'

type ITestSignal = {
  aborted: boolean
  reason?: unknown
  addEventListener: () => void
  removeEventListener: () => void
}

const signal = (aborted = false, reason?: unknown): ITestSignal => ({
  aborted,
  reason,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
})

describe('signal round 2 contract', () => {
  it('MP-T51/MP-T67 exports structural signal surface and preserves package boundary', async () => {
    const module = await import('../src/index.js')
    expect(typeof module.createPipeline).toBe('function')
    expect(module).not.toHaveProperty('runSyncMiddleware')
    expect(module).not.toHaveProperty('runAsyncMiddleware')
    expect(module).not.toHaveProperty('runGeneratorMiddleware')
    expect(module).not.toHaveProperty('runAsyncGeneratorMiddleware')
    expect(module).not.toHaveProperty('adaptSyncStageToAsync')
    expect(module).not.toHaveProperty('adaptSyncStageToGenerator')
    expect(module).not.toHaveProperty('adaptGeneratorStageToAsyncGenerator')
    expect(module).not.toHaveProperty('adaptSyncStageToAsyncGenerator')
    expect(module.MIDDLEWARE_PIPELINE_SOURCE).toBe('@migaia/middleware-pipeline')
  })

  it('MP-T56 rejects sync candidate after cooperative abort', () => {
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      addEventListener() {},
      removeEventListener() {}
    }
    let nextRuns = 0
    expect(() =>
      runSyncForTest(
        [
          (_value, next, context) => {
            aborted = true
            nextRuns += 1
            next(2)
            expect(context?.signal).toBe(input)
          }
        ],
        1,
        () => {
          nextRuns += 10
        },
        () => undefined,
        { signal: input }
      )
    ).toThrow('middleware pipeline aborted')
    expect(nextRuns).toBe(1)
  })

  it('MP-T57/MP-T62 keeps cooperative async work strict-drained', async () => {
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      addEventListener() {},
      removeEventListener() {}
    }
    let settled = false
    await expect(
      runAsyncGeneratorForTest(
        [
          async function* (value, context) {
            yield value
            aborted = true
            settled = true
            expect(context?.signal).toBe(input)
            return GENERATOR_CONTINUE
          }
        ],
        1,
        () => undefined,
        undefined,
        { signal: input }
      )
    ).rejects.toThrow('middleware pipeline aborted')
    expect(settled).toBe(true)
  })

  it('MP-T58/MP-T63 preserves business failure over later abort', async () => {
    const failure = new Error('stage')
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      addEventListener() {},
      removeEventListener() {}
    }
    await expect(
      runAsyncGeneratorForTest(
        [
          async function* () {
            throw failure
          }
        ],
        1,
        () => undefined,
        undefined,
        { signal: input }
      )
    ).rejects.toBe(failure)
  })

  it('MP-T60 cleanup failure retains fixed primary-first slots', () => {
    let reads = 0
    const input = {
      get aborted() {
        reads += 1
        return reads >= 3
      },
      addEventListener() {},
      removeEventListener() {}
    }
    const failCleanup = (): never => {
      throw new Error('cleanup')
    }
    function* stage(): Generator<number, any, void> {
      try {
        yield 1
      } finally {
        failCleanup()
      }
    }
    const abort = new Error('abort')
    Object.defineProperty(input, 'reason', { value: abort })
    try {
      runGeneratorForTest([stage], 1, () => undefined, undefined, { signal: input })
      throw new Error('expected cleanup aggregate')
    } catch (error) {
      expect(error).toMatchObject({ code: 'ABORT_CLEANUP_FAILED' })
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors[0]).toBe(abort)
      expect((error as AggregateError).errors[1]).toBeInstanceOf(Error)
    }
  })

  it('MP-T64 done admission and MP-T65 checkpoint reason reads are fail-closed', () => {
    const reason = new Error('abort')
    const input = { aborted: true, reason, addEventListener() {}, removeEventListener() {} }
    let done = false
    expect(() =>
      runSyncForTest(
        [],
        1,
        () => {
          done = true
        },
        () => undefined,
        { signal: input }
      )
    ).toThrow(reason)
    expect(done).toBe(false)
  })

  it('MP-T66 isolates invocation contexts and MP-T68 keeps docs-facing host baseline callable', () => {
    const first = signal()
    const second = signal()
    let contexts: unknown[] = []
    runSyncForTest(
      [
        (_value, next, context) => {
          contexts.push(context)
          next(1)
        }
      ],
      0,
      (_value, context) => contexts.push(context),
      () => undefined,
      { signal: first }
    )
    runSyncForTest(
      [
        (_value, next, context) => {
          contexts.push(context)
          next(1)
        }
      ],
      0,
      (_value, context) => contexts.push(context),
      () => undefined,
      { signal: second }
    )
    expect((contexts[0] as { signal: unknown }).signal).toBe(first)
    expect((contexts[2] as { signal: unknown }).signal).toBe(second)
  })

  it('MP-T66 isolates concurrent async-generator cleanup failures', async () => {
    const run = async (label: string): Promise<unknown> => {
      let aborted = false
      const input = {
        get aborted() {
          return aborted
        },
        reason: new Error(`${label}-abort`),
        addEventListener() {},
        removeEventListener() {}
      }
      const result = runAsyncGeneratorForTest(
        [
          async function* () {
            try {
              yield label
              await Promise.resolve()
            } finally {
              // oxlint-disable-next-line no-unsafe-finally -- cleanup failure is the contract under test.
              throw new Error(`${label}-cleanup`)
            }
          }
        ],
        label,
        () => undefined,
        undefined,
        { signal: input }
      )
      await Promise.resolve()
      aborted = true
      return result.catch((error) => error)
    }
    const [first, second] = await Promise.all([run('first'), run('second')])
    expect((first as AggregateError).errors[0]).toMatchObject({ message: 'first-abort' })
    expect((first as AggregateError).errors[1]).toMatchObject({ message: 'first-cleanup' })
    expect((second as AggregateError).errors[0]).toMatchObject({ message: 'second-abort' })
    expect((second as AggregateError).errors[1]).toMatchObject({ message: 'second-cleanup' })
  })

  it('MP-T57 keeps async middleware pending until cooperative work settles', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      addEventListener() {},
      removeEventListener() {}
    }
    let nextCalled = false
    const run = runAsyncMiddlewareForTest(gate, input, () => {
      nextCalled = true
    })
    aborted = true
    release()
    await expect(run).rejects.toThrow('middleware pipeline aborted')
    expect(nextCalled).toBe(false)
  })

  it('MP-T58/MP-T63 preserves async control and business failure precedence', async () => {
    const business = new Error('business')
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      addEventListener() {},
      removeEventListener() {}
    }
    const run = runAsyncMiddlewareForTest(Promise.resolve(), input, () => undefined, business)
    aborted = true
    await expect(run).rejects.toBe(business)
  })

  it('MP-T62 keeps non-cooperative async work pending', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      addEventListener() {},
      removeEventListener() {}
    }
    const pending = runAsyncMiddlewareForTest(gate, input, () => undefined, undefined, true)
    await Promise.resolve()
    aborted = true
    const marker = await Promise.race([
      pending.then(
        () => 'settled',
        () => 'rejected'
      ),
      Promise.resolve('pending')
    ])
    expect(marker).toBe('pending')
    release()
    await expect(pending).rejects.toThrow('middleware pipeline aborted')
  })

  it('MP-T64 keeps a started done callback responsible for its own cancellation', async () => {
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      addEventListener() {},
      removeEventListener() {}
    }
    let started = false
    await runAsyncForTest(
      [],
      1,
      async (_value, context) => {
        started = true
        expect(context?.signal).toBe(input)
        aborted = true
      },
      { onViolation: () => undefined, signal: input }
    )
    expect(started).toBe(true)
  })

  it('MP-T65 observes hostile reason once at first abort checkpoint', () => {
    let reads = 0
    const reason = new Error('first')
    const input = {
      get aborted() {
        return ++reads >= 2
      },
      get reason() {
        return reason
      },
      addEventListener() {},
      removeEventListener() {}
    }
    expect(() =>
      runSyncForTest(
        [(_value, next) => next(2)],
        1,
        () => undefined,
        () => undefined,
        { signal: input }
      )
    ).toThrow(reason)
    expect(reads).toBe(2)
  })

  it('MP-T65 does not read reason while checkpoints remain active', () => {
    let reasonReads = 0
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      get reason() {
        reasonReads += 1
        throw new Error('reason read')
      },
      addEventListener() {},
      removeEventListener() {}
    }
    runSyncForTest(
      [(_value, next) => next(2)],
      1,
      () => undefined,
      () => undefined,
      {
        signal: input
      }
    )
    expect(reasonReads).toBe(0)
    aborted = true
    expect(() =>
      runSyncForTest(
        [],
        1,
        () => undefined,
        () => undefined,
        { signal: input }
      )
    ).toThrow('reason read')
    expect(reasonReads).toBe(1)
  })

  it('MP-T65 freezes first abort reason before later getter mutation', () => {
    const first = new Error('first')
    const second = new Error('second')
    let abortedReads = 0
    let reasonReads = 0
    const input = {
      get aborted() {
        abortedReads += 1
        return abortedReads >= 2
      },
      get reason() {
        reasonReads += 1
        if (reasonReads > 1) throw second
        return first
      },
      addEventListener() {},
      removeEventListener() {}
    }
    expect(() =>
      runSyncForTest(
        [(_value, next) => next(2)],
        1,
        () => undefined,
        () => undefined,
        {
          signal: input
        }
      )
    ).toThrow(first)
    expect(reasonReads).toBe(1)
  })

  it('MP-T58 collapses nested downstream abort and preserves combiner call count for ordinary dual failure', async () => {
    const abort = new Error('abort')
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      get reason() {
        return abort
      },
      addEventListener() {},
      removeEventListener() {}
    }
    const downstream = new Error('downstream')
    const combine = vi.fn((stage: unknown, child: unknown) => new AggregateError([stage, child]))
    const run = runAsyncForTest(
      [
        async (_value, next) => {
          await next(2)
        },
        async () => {
          throw downstream
        }
      ],
      1,
      () => undefined,
      { onViolation: () => undefined, signal: input, combineStageAndDownstreamError: combine }
    )
    aborted = true
    await expect(run).rejects.toBe(abort)
    expect(combine).not.toHaveBeenCalled()
  })

  it('MP-T58 separately proves ordinary dual failure combiner receives both exact failures once', async () => {
    const stageFailure = new Error('stage')
    const downstreamFailure = new Error('downstream')
    const combine = vi.fn((stage: unknown, downstream: unknown) => ({ stage, downstream }))
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            void next(2)
            throw stageFailure
          },
          async () => {
            throw downstreamFailure
          }
        ],
        1,
        () => undefined,
        { onViolation: () => undefined, combineStageAndDownstreamError: combine }
      )
    ).rejects.toMatchObject({ stage: stageFailure, downstream: downstreamFailure })
    expect(combine).toHaveBeenCalledTimes(1)
    expect(combine).toHaveBeenCalledWith(stageFailure, downstreamFailure)
  })

  it('MP-T58 preserves post-stage abort control over downstream failure', async () => {
    const abort = new Error('abort')
    const downstream = new Error('downstream')
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      reason: abort,
      addEventListener() {},
      removeEventListener() {}
    }
    const combine = vi.fn(() => new Error('combined'))
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            const pending = next(2)
            aborted = true
            await pending
          },
          async () => {
            throw downstream
          }
        ],
        1,
        () => undefined,
        { onViolation: () => undefined, signal: input, combineStageAndDownstreamError: combine }
      )
    ).rejects.toBe(abort)
    expect(combine).not.toHaveBeenCalled()
  })

  it('MP-T58 collapses upstream and downstream throws of the same abort reason', async () => {
    const abort = new Error('same-abort')
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      reason: abort,
      addEventListener() {},
      removeEventListener() {}
    }
    const combine = vi.fn(() => new Error('combined'))
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            let downstreamFailed = false
            aborted = true
            try {
              await next(2)
            } catch (error) {
              downstreamFailed = error === abort
            }
            if (downstreamFailed) throw abort
          },
          async () => {
            throw abort
          }
        ],
        1,
        () => undefined,
        { onViolation: () => undefined, signal: input, combineStageAndDownstreamError: combine }
      )
    ).rejects.toBe(abort)
    expect(combine).not.toHaveBeenCalled()
  })

  it('MP-T58 preserves independent upstream stage error over child abort control', async () => {
    const abort = new Error('child-abort')
    const stageFailure = new Error('upstream-stage')
    let aborted = false
    const input = {
      get aborted() {
        return aborted
      },
      reason: abort,
      addEventListener() {},
      removeEventListener() {}
    }
    const combine = vi.fn(() => new Error('combined'))
    await expect(
      runAsyncForTest(
        [
          async (_value, next) => {
            aborted = true
            void next(2)
            throw stageFailure
          },
          async () => undefined
        ],
        1,
        () => undefined,
        { onViolation: () => undefined, signal: input, combineStageAndDownstreamError: combine }
      )
    ).rejects.toBe(stageFailure)
    expect(combine).not.toHaveBeenCalled()
  })

  it('MP-T52/MP-T55 preserves legacy callback arity and passes one frozen context when enabled', () => {
    const legacy: number[] = []
    runSyncForTest(
      [
        function (_value, _next) {
          legacy.push(arguments.length)
        }
      ],
      1,
      () => undefined,
      () => undefined
    )
    expect(legacy).toEqual([2])

    let observed: unknown
    const input = signal()
    runSyncForTest(
      [
        (_value, next, context) => {
          observed = context
          next(2)
        }
      ],
      1,
      () => undefined,
      () => undefined,
      { signal: input }
    )
    expect(observed).toMatchObject({ signal: input })
    expect(Object.isFrozen(observed)).toBe(true)
  })

  it('MP-T53/MP-T54 fails invalid and pre-aborted admission before user code', async () => {
    const input = signal(true, 'stop')
    let touched = false
    expect(() =>
      runSyncForTest(
        [
          () => {
            touched = true
          }
        ],
        1,
        () => {
          touched = true
        },
        () => undefined,
        { signal: input }
      )
    ).toThrow('middleware pipeline aborted')
    expect(touched).toBe(false)
    expect(() =>
      runSyncForTest(
        [],
        1,
        () => undefined,
        () => undefined,
        null as never
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION' }))
    await expect(
      runAsyncGeneratorForTest([], 1, () => undefined, undefined, null as never)
    ).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_OPTION' }))
    const admissionCause = new Error('hostile aborted getter')
    const malformedSignal = {
      get aborted(): never {
        throw admissionCause
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
    let malformedError: unknown
    try {
      runSyncForTest(
        [],
        1,
        () => undefined,
        () => undefined,
        { signal: malformedSignal }
      )
    } catch (error) {
      malformedError = error
    }
    expect(malformedError).toMatchObject({ code: 'INVALID_OPTION' })
    expect((malformedError as Error).cause).toBe(admissionCause)
  })

  it('MP-T59/MP-T61 drains generator cleanup once without exposing cleanup yields', async () => {
    let syncReads = 0
    const syncInput = {
      get aborted() {
        syncReads += 1
        return syncReads >= 3
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
    let cleanup = 0
    function* stage(): Generator<number, any, void> {
      try {
        yield 2
      } finally {
        cleanup += 1
        yield 99
      }
      return GENERATOR_CONTINUE
    }
    expect(() =>
      runGeneratorForTest([stage], 1, () => undefined, undefined, { signal: syncInput })
    ).toThrow('middleware pipeline aborted')

    let asyncReads = 0
    const asyncInput = {
      get aborted() {
        asyncReads += 1
        return asyncReads >= 3
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
    async function* asyncStage(): AsyncGenerator<number, any, void> {
      try {
        yield 2
      } finally {
        cleanup += 1
        yield 99
      }
      return GENERATOR_CONTINUE
    }
    await expect(
      runAsyncGeneratorForTest([asyncStage], 1, () => undefined, undefined, {
        signal: asyncInput
      })
    ).rejects.toThrow('middleware pipeline aborted')
    expect(cleanup).toBe(2)
  })
})

const runAsyncMiddlewareForTest = (
  gate: Promise<void>,
  signal: { readonly aborted: boolean; addEventListener(): void; removeEventListener(): void },
  onNext: () => void,
  business?: Error,
  ignoreSignal = false
): Promise<void> =>
  runAsyncForTest(
    [
      async (value, next, context) => {
        await gate
        if (business) throw business
        if (!ignoreSignal && context?.signal.aborted) return
        await next(value)
        onNext()
      }
    ],
    1,
    () => undefined,
    { onViolation: () => undefined, signal }
  )
