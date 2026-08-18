import { describe, expect, it } from 'vitest';
import {
  adaptSyncStageToAsync,
  adaptSyncStageToGenerator,
  GENERATOR_CONTINUE,
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation,
  runAsyncMiddleware,
  runGeneratorMiddleware,
  runSyncMiddleware
} from '@migaia/middleware-pipeline';
import type {
  IAsyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  ISyncMiddlewareStage
} from '@migaia/middleware-pipeline';

describe('package exports', () => {
  it('resolves and executes runtime and declaration exports through package boundary', async () => {
    const stage: ISyncMiddlewareStage<number> = (value, next) => next(value + 1);
    const asyncStage: IAsyncMiddlewareStage<number> = async (value, next) => next(value + 1);
    const generatorStage: IGeneratorMiddlewareStage<number> = function* (value) {
      yield value + 1;
      return GENERATOR_CONTINUE;
    };
    const values: number[] = [];
    const asyncValues: number[] = [];
    const generatorValues: number[] = [];

    runSyncMiddleware(
      [stage],
      1,
      (value) => values.push(value),
      () => undefined
    );
    await runAsyncMiddleware(
      [asyncStage],
      1,
      (value) => {
        asyncValues.push(value);
      },
      { onViolation: () => undefined }
    );
    runGeneratorMiddleware([generatorStage], 1, (value) => generatorValues.push(value));
    await adaptSyncStageToAsync(stage)(1, () => Promise.resolve());
    const adaptedGenerator = adaptSyncStageToGenerator(stage, () => undefined);

    expect(typeof adaptSyncStageToAsync).toBe('function');
    expect(typeof adaptSyncStageToGenerator).toBe('function');
    expect(MiddlewarePipelineMode.sync).toBe('sync');
    expect(MiddlewarePipelineViolation.late).toBe('late');
    expect(MIDDLEWARE_PIPELINE_SOURCE).toBe('@migaia/middleware-pipeline');
    expect(MiddlewarePipelineErrorCode.executionFailed).toBe('EXECUTION_FAILED');
    expect(values).toEqual([2]);
    expect(asyncValues).toEqual([2]);
    expect(generatorValues).toEqual([2]);
    expect(adaptedGenerator(1).next()).toEqual({ value: 2, done: false });
  });
});
