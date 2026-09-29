import { describe, expect, it, vi } from 'vitest'
import {
  createPipeline,
  GENERATOR_CONTINUE,
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  MiddlewarePipelineMode,
  type IAsyncGeneratorMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IMiddlewarePipelineAbortSignal,
  type IMiddlewarePipelineMode
} from '../src/index.js'

/** Creates a structural signal whose reason getter records exactly one read and throws. */
const throwingReasonSignal = (failure: unknown, initiallyAborted: boolean) => {
  let aborted = initiallyAborted
  let reads = 0
  return {
    signal: {
      get aborted() {
        return aborted
      },
      get reason(): never {
        reads += 1
        throw failure
      },
      addEventListener() {},
      removeEventListener() {}
    } satisfies IMiddlewarePipelineAbortSignal,
    abort: () => {
      aborted = true
    },
    reads: () => reads
  }
}

/** Runs a mode through its public pipeline while preserving its sync or Promise failure shape. */
const runMode = (
  mode: IMiddlewarePipelineMode,
  signal: IMiddlewarePipelineAbortSignal,
  duringStage: (() => void) | undefined,
  downstream = vi.fn(),
  done = vi.fn()
): unknown => {
  if (mode === MiddlewarePipelineMode.sync) {
    const pipeline = createPipeline<number>({ mode, signal })
    const stages = [
      (value: number, next: (value: number) => void) => {
        duringStage?.()
        next(value)
      },
      downstream
    ]
    return pipeline.run(stages, 1, done)
  }
  if (mode === MiddlewarePipelineMode.async) {
    const pipeline = createPipeline<number>({ mode, signal })
    const stages = [
      async (value: number, next: (value: number) => Promise<void>) => {
        duringStage?.()
        await next(value)
      },
      downstream
    ]
    return pipeline.run(stages, 1, done)
  }
  if (mode === MiddlewarePipelineMode.generator) {
    const pipeline = createPipeline<number>({ mode, signal })
    const stages: readonly IGeneratorMiddlewareStage<number>[] = [
      function* (value: number) {
        duringStage?.()
        yield value
        return GENERATOR_CONTINUE
      },
      function* (value: number) {
        downstream()
        yield value
        return GENERATOR_CONTINUE
      }
    ]
    return pipeline.run(stages, 1, done)
  }
  const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.asyncGenerator, signal })
  const stages: readonly IAsyncGeneratorMiddlewareStage<number>[] = [
    async function* (value: number) {
      duringStage?.()
      yield value
      return GENERATOR_CONTINUE
    },
    async function* (value: number) {
      downstream()
      yield value
      return GENERATOR_CONTINUE
    }
  ]
  return pipeline.run(stages, 1, done)
}

/** Extracts a synchronous failure without converting it into an asynchronous one. */
const thrown = (run: () => unknown): unknown => {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a synchronous failure')
}

/** Asserts package identity and cause shape for an invalid-option failure. */
const expectInvalidOption = (
  failure: unknown,
  message: string,
  cause?: unknown,
  hasCause = false
) => {
  expect(failure).toBeInstanceOf(TypeError)
  expect(failure).toMatchObject({
    source: MIDDLEWARE_PIPELINE_SOURCE,
    code: MiddlewarePipelineErrorCode.invalidOption,
    message
  })
  expect(Object.hasOwn(failure as object, 'cause')).toBe(hasCause)
  if (hasCause) expect((failure as Error).cause).toBe(cause)
}

describe('pipeline internal cleanup', () => {
  it('A1 preserves invalid-option text, native type, and own cause for seven admissions', () => {
    const invalidMode = 'middleware pipeline mode is invalid'
    const invalidSignal = 'middleware pipeline signal option is invalid'
    const unsupportedLift = 'middleware pipeline stage cannot be lifted to the target mode'
    expectInvalidOption(
      thrown(() => createPipeline(null as never)),
      invalidMode
    )
    expectInvalidOption(
      thrown(() => createPipeline({ mode: 'parallel' } as never)),
      invalidMode
    )
    expectInvalidOption(
      thrown(() => createPipeline({ mode: MiddlewarePipelineMode.sync, onViolation: 1 } as never)),
      invalidSignal
    )
    const pipeline = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })
    expectInvalidOption(
      thrown(() => pipeline.lift((() => {}) as never, MiddlewarePipelineMode.async as never)),
      unsupportedLift
    )
    expectInvalidOption(
      thrown(() => pipeline.lift((() => {}) as never, 'bogus' as never)),
      unsupportedLift
    )
    expectInvalidOption(
      thrown(() => pipeline.run([], 1, () => {}, { signal: 1 } as never)),
      invalidSignal,
      undefined,
      true
    )
    const sentinel = new Error('signal getter')
    const signal = {
      get aborted(): never {
        throw sentinel
      },
      addEventListener() {},
      removeEventListener() {}
    }
    expectInvalidOption(
      thrown(() => pipeline.run([], 1, () => {}, { signal })),
      invalidSignal,
      sentinel,
      true
    )
  })

  it('A2 preserves control admission and cancellation timing across four modes', async () => {
    const modes = Object.values(MiddlewarePipelineMode)
    const invalidControls = [null, 1, [], Object.assign(() => {}, { signal: undefined })]
    for (const mode of modes) {
      for (const control of invalidControls) {
        const stage = vi.fn()
        const done = vi.fn()
        const pipeline = createPipeline<number>({ mode } as never)
        const run = () => pipeline.run([stage] as never, 1, done, control as never)
        if (mode === MiddlewarePipelineMode.sync || mode === MiddlewarePipelineMode.generator)
          expectInvalidOption(thrown(run), 'middleware pipeline signal option is invalid')
        else
          expectInvalidOption(
            await (run() as unknown as Promise<void>).catch((error: unknown) => error),
            'middleware pipeline signal option is invalid'
          )
        expect(stage).not.toHaveBeenCalled()
        expect(done).not.toHaveBeenCalled()
      }
      const reason = new Error('cancelled')
      const stage = vi.fn()
      const pipeline = createPipeline<number>({ mode } as never)
      const run = () =>
        pipeline.run([stage] as never, 1, vi.fn(), { signal: AbortSignal.abort(reason) })
      if (mode === MiddlewarePipelineMode.sync || mode === MiddlewarePipelineMode.generator)
        expect(thrown(run)).toBe(reason)
      else
        expect(await (run() as unknown as Promise<void>).catch((error: unknown) => error)).toBe(
          reason
        )
      expect(stage).not.toHaveBeenCalled()
    }
  })

  it('A5 retains an Error thrown by reason getters across modes and timing', async () => {
    const original = new Error('reason failure')
    for (const mode of Object.values(MiddlewarePipelineMode)) {
      for (const duringStage of [false, true]) {
        const fixture = throwingReasonSignal(original, !duringStage)
        const run = () => runMode(mode, fixture.signal, duringStage ? fixture.abort : undefined)
        const failure =
          mode === MiddlewarePipelineMode.sync || mode === MiddlewarePipelineMode.generator
            ? thrown(run)
            : await (run() as Promise<void>).catch((error: unknown) => error)
        expect(failure).toBe(original)
        expect(fixture.reads()).toBe(1)
      }
    }
  })
})
