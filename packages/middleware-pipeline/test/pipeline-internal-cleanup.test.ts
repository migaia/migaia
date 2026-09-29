import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

/** Source directory used to prove internal ownership and import order. */
const sourceDirectory = fileURLToPath(new URL('../src/', import.meta.url))

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

  it('A3 has one error factory, one control admission, and ordered runtime imports', () => {
    const files = readdirSync(sourceDirectory).filter((name) => name.endsWith('.ts'))
    const source = files.map(
      (name) => [name, readFileSync(`${sourceDirectory}/${name}`, 'utf8')] as const
    )
    expect(
      source.flatMap(([name, text]) => [...text.matchAll(/new TypeError\(/g)].map(() => name))
    ).toEqual(['signal-errors.ts'])
    const create = source.find(([name]) => name === 'create-pipeline.ts')?.[1] ?? ''
    const runtime = source.find(([name]) => name === 'runtime.ts')?.[1] ?? ''
    expect(create).not.toContain('const invalidOption')
    expect(runtime).not.toMatch(/readControlSignal|readAsyncSignal|invalidSignal/)
    expect(runtime.lastIndexOf('import ')).toBeLessThan(
      runtime.indexOf('function invokeWithContext')
    )
    expect(runtime).toMatch(
      /\/\*\* Explicit generator result[^]*?\*\/\s*type IGeneratorUndefinedSignal/
    )
  })

  it('A4 wraps primitive reason getter failures in all modes and preserves cleanup order', async () => {
    for (const mode of Object.values(MiddlewarePipelineMode)) {
      for (const duringStage of [false, true]) {
        const fixture = throwingReasonSignal('boom', !duringStage)
        const downstream = vi.fn()
        const done = vi.fn()
        const run = () =>
          runMode(mode, fixture.signal, duringStage ? fixture.abort : undefined, downstream, done)
        const failure =
          mode === MiddlewarePipelineMode.sync || mode === MiddlewarePipelineMode.generator
            ? thrown(run)
            : await (run() as Promise<void>).catch((error: unknown) => error)
        expect(failure).toMatchObject({
          message: 'middleware pipeline aborted',
          source: MIDDLEWARE_PIPELINE_SOURCE,
          code: MiddlewarePipelineErrorCode.aborted,
          cause: 'boom'
        })
        expect(failure).toBeInstanceOf(Error)
        expect(fixture.reads()).toBe(1)
        expect(downstream).not.toHaveBeenCalled()
        expect(done).not.toHaveBeenCalled()
      }
    }
    const fixture = throwingReasonSignal('boom', false)
    const cleanup = new Error('cleanup')
    /** Raises the cleanup failure without obscuring the generator's primary abort in source. */
    const failCleanup = (): never => {
      throw cleanup
    }
    const pipeline = createPipeline<number>({
      mode: MiddlewarePipelineMode.generator,
      signal: fixture.signal
    })
    const failure = thrown(() =>
      pipeline.run(
        [
          function* (value): Generator<number, typeof GENERATOR_CONTINUE, void> {
            try {
              yield value
              fixture.abort()
              yield value
            } finally {
              failCleanup()
            }
            return GENERATOR_CONTINUE
          }
        ],
        1,
        vi.fn()
      )
    )
    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure).toMatchObject({ code: MiddlewarePipelineErrorCode.abortCleanupFailed })
    expect((failure as AggregateError).errors[0]).toMatchObject({
      code: MiddlewarePipelineErrorCode.aborted,
      cause: 'boom'
    })
    expect((failure as AggregateError).errors[1]).toBe(cleanup)
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
  it('A6 uses guarded reason reads and documents every invalid-option scenario', () => {
    const files = readdirSync(sourceDirectory).filter((name) => name.endsWith('.ts'))
    const source = files
      .map((name) => readFileSync(`${sourceDirectory}/${name}`, 'utf8'))
      .join('\n')
    const runtime = readFileSync(`${sourceDirectory}/runtime.ts`, 'utf8')
    const codes = readFileSync(`${sourceDirectory}/error-code.ts`, 'utf8')
    expect(runtime).toMatch(/import \{ tryReadProperty \} from '@migaia\/utils\/error'/)
    expect((runtime.match(/tryReadProperty\([^\n]*, 'reason'\)/g) ?? []).length).toBe(2)
    expect(source).not.toMatch(/\.reason\b/)
    const comment = codes.slice(
      codes.indexOf('/**', codes.indexOf('executionFailed:')),
      codes.indexOf("invalidOption: 'INVALID_OPTION'")
    )
    for (const scenario of ['mode', 'onViolation', 'signal', 'signals', 'lift'])
      expect(comment).toContain(scenario)
  })
})
