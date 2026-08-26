import { describe, expect, it } from 'vitest'
import {
  adaptGeneratorStageToAsyncGenerator,
  adaptSyncStageToAsync,
  adaptSyncStageToAsyncGenerator,
  adaptSyncStageToGenerator,
  GENERATOR_CONTINUE,
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation,
  runAsyncMiddleware,
  runAsyncGeneratorMiddleware,
  runGeneratorMiddleware,
  runSyncMiddleware
} from '@migaia/middleware-pipeline'
import type {
  IAsyncGeneratorMiddlewareStage,
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'

describe('package exports', () => {
  it('MP-T51/MP-T67 exposes signal contract through package boundary', async () => {
    const packageRoot = await import('@migaia/middleware-pipeline')
    expect(packageRoot.runSyncMiddleware).toBeTypeOf('function')
    expect(packageRoot.MIDDLEWARE_PIPELINE_SOURCE).toBe('@migaia/middleware-pipeline')
  })
  it('resolves and executes runtime and declaration exports through package boundary', async () => {
    const stage: ISyncMiddlewareStage<number> = (value, next) => next(value + 1)
    const asyncStage: IAsyncMiddlewareStage<number> = async (value, next) => next(value + 1)
    const generatorStage: IGeneratorMiddlewareStage<number> = function* (value) {
      yield value + 1
      return GENERATOR_CONTINUE
    }
    const asyncGeneratorStage: IAsyncGeneratorMiddlewareStage<number> = async function* (value) {
      yield value + 1
      return GENERATOR_CONTINUE
    }
    const values: number[] = []
    const asyncValues: number[] = []
    const generatorValues: number[] = []
    const asyncGeneratorValues: number[] = []

    runSyncMiddleware(
      [stage],
      1,
      (value) => values.push(value),
      () => undefined
    )
    await runAsyncMiddleware(
      [asyncStage],
      1,
      (value) => {
        asyncValues.push(value)
      },
      { onViolation: () => undefined }
    )
    runGeneratorMiddleware([generatorStage], 1, (value) => generatorValues.push(value))
    await runAsyncGeneratorMiddleware([asyncGeneratorStage], 1, (value) => {
      asyncGeneratorValues.push(value)
    })
    await adaptSyncStageToAsync(stage)(1, () => Promise.resolve())
    const adaptedGenerator = adaptSyncStageToGenerator(stage, () => undefined)
    const adaptedAsyncGenerator = adaptSyncStageToAsyncGenerator(stage, () => undefined)
    const promotedGenerator = adaptGeneratorStageToAsyncGenerator(generatorStage)

    expect(typeof adaptSyncStageToAsync).toBe('function')
    expect(typeof adaptSyncStageToGenerator).toBe('function')
    expect(typeof adaptSyncStageToAsyncGenerator).toBe('function')
    expect(typeof adaptGeneratorStageToAsyncGenerator).toBe('function')
    expect(typeof runAsyncGeneratorMiddleware).toBe('function')
    expect(MiddlewarePipelineMode.sync).toBe('sync')
    expect(MiddlewarePipelineMode.asyncGenerator).toBe('async-generator')
    expect(MiddlewarePipelineViolation.late).toBe('late')
    expect(MIDDLEWARE_PIPELINE_SOURCE).toBe('@migaia/middleware-pipeline')
    expect(MiddlewarePipelineErrorCode.executionFailed).toBe('EXECUTION_FAILED')
    expect(values).toEqual([2])
    expect(asyncValues).toEqual([2])
    expect(generatorValues).toEqual([2])
    expect(asyncGeneratorValues).toEqual([2])
    expect(adaptedGenerator(1).next()).toEqual({ value: 2, done: false })
    expect(await adaptedAsyncGenerator(1).next()).toEqual({ value: 2, done: false })
    expect(await promotedGenerator(1).next()).toEqual({ value: 2, done: false })
  })
})
