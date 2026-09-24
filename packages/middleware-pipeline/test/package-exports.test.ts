import { describe, expect, it } from 'vitest'
import {
  createPipeline,
  GENERATOR_CONTINUE,
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation
} from '@migaia/middleware-pipeline'
import type {
  IAsyncGeneratorMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'

describe('package exports', () => {
  it('MP-T51/MP-T67 exposes signal contract through package boundary', async () => {
    /** Runtime package root used to verify the breaking export migration. */
    const packageRoot = await import('@migaia/middleware-pipeline')
    expect(packageRoot.createPipeline).toBeTypeOf('function')
    expect(packageRoot).not.toHaveProperty('runSyncMiddleware')
    expect(packageRoot).not.toHaveProperty('runAsyncMiddleware')
    expect(packageRoot).not.toHaveProperty('runGeneratorMiddleware')
    expect(packageRoot).not.toHaveProperty('runAsyncGeneratorMiddleware')
    expect(packageRoot).not.toHaveProperty('adaptSyncStageToAsync')
    expect(packageRoot).not.toHaveProperty('adaptSyncStageToGenerator')
    expect(packageRoot).not.toHaveProperty('adaptGeneratorStageToAsyncGenerator')
    expect(packageRoot).not.toHaveProperty('adaptSyncStageToAsyncGenerator')
    expect(packageRoot.MIDDLEWARE_PIPELINE_SOURCE).toBe('@migaia/middleware-pipeline')
  })

  it('resolves and executes runtime and declaration exports through package boundary', async () => {
    /** Sync stage shared by direct sync execution and lift checks. */
    const stage: ISyncMiddlewareStage<number> = (value, next) => next(value + 1)
    /** Native async stage used by the async mode. */
    const asyncStage: IAsyncMiddlewareStage<number> = async (value, next) => next(value + 1)
    /** Generator stage used by generator execution and promotion. */
    const generatorStage: IGeneratorMiddlewareStage<number> = function* (value) {
      yield value + 1
      return GENERATOR_CONTINUE
    }
    /** Native async-generator stage used by the async-generator mode. */
    const asyncGeneratorStage: IAsyncGeneratorMiddlewareStage<number> = async function* (value) {
      yield value + 1
      return GENERATOR_CONTINUE
    }
    /** Terminal values emitted by the four public modes. */
    const values: number[] = []
    /** Public mode instances resolved through the package boundary. */
    const sync = createPipeline<number>({ mode: MiddlewarePipelineMode.sync })
    const async = createPipeline<number>({ mode: MiddlewarePipelineMode.async })
    const generator = createPipeline<number>({ mode: MiddlewarePipelineMode.generator })
    const asyncGenerator = createPipeline<number>({
      mode: MiddlewarePipelineMode.asyncGenerator
    })

    sync.run([stage], 1, (value) => values.push(value))
    await async.run([asyncStage], 1, (value) => {
      values.push(value)
    })
    generator.run([generatorStage], 1, (value) => values.push(value))
    await asyncGenerator.run([asyncGeneratorStage], 1, (value) => {
      values.push(value)
    })

    /** Lifted stages prove every former adapter path remains reachable from `lift`. */
    const adaptedAsync = async.lift(stage, MiddlewarePipelineMode.sync)
    const adaptedGenerator = generator.lift(stage, MiddlewarePipelineMode.sync)
    const adaptedAsyncGenerator = asyncGenerator.lift(stage, MiddlewarePipelineMode.sync)
    const promotedGenerator = asyncGenerator.lift(generatorStage, MiddlewarePipelineMode.generator)
    await adaptedAsync(1, () => Promise.resolve())

    expect(MiddlewarePipelineMode.sync).toBe('sync')
    expect(MiddlewarePipelineMode.asyncGenerator).toBe('async-generator')
    expect(MiddlewarePipelineViolation.late).toBe('late')
    expect(MIDDLEWARE_PIPELINE_SOURCE).toBe('@migaia/middleware-pipeline')
    expect(MiddlewarePipelineErrorCode.executionFailed).toBe('EXECUTION_FAILED')
    expect(values).toEqual([2, 2, 2, 2])
    expect(adaptedGenerator(1).next()).toEqual({ value: 2, done: false })
    expect(await adaptedAsyncGenerator(1).next()).toEqual({ value: 2, done: false })
    expect(await promotedGenerator(1).next()).toEqual({ value: 2, done: false })
  })
})
