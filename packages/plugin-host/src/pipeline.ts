import {
  adaptSyncStageToAsync as adaptAsync,
  adaptSyncStageToGenerator as adaptGenerator,
  runAsyncMiddleware,
  runGeneratorMiddleware,
  runSyncMiddleware,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IMiddlewarePipelineViolationHandler,
  type ISyncMiddlewareStage
} from '@migaia/middleware-pipeline';
import ERROR_TEXT, { createPluginHostTypeError, tagPluginHostError } from './error-text.js';
import { PluginHostErrorCode } from './error-code.js';
import type {
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPipelineMode,
  ISyncPipelineStage
} from './typing.js';
import { GENERATOR_CONTINUE, GENERATOR_HALT, GENERATOR_UNDEFINED } from './typing.js';
import { PluginHostPipelineMode } from './state-constants.js';

/** Preserves plugin-host's existing public Symbol identities while delegating the runner. */
const PLUGIN_HOST_GENERATOR_SIGNALS = {
  undefined: GENERATOR_UNDEFINED,
  halt: GENERATOR_HALT,
  continue: GENERATOR_CONTINUE
} as const;

/** Compatibility adapter: plugin-host keeps its public stage names and error policy. */
export const adaptSyncStageToAsync = <TValue>(
  stage: ISyncPipelineStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler = () => {}
): IAsyncPipelineStage<TValue> =>
  adaptAsync(stage as ISyncMiddlewareStage<TValue>, onViolation) as IAsyncPipelineStage<TValue>;

/** Compatibility adapter: plugin-host keeps its public stage names and sentinel contract. */
export const adaptSyncStageToGenerator = <TValue>(
  stage: ISyncPipelineStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler
): IGeneratorPipelineStage<TValue> =>
  adaptGenerator(
    stage as ISyncMiddlewareStage<TValue>,
    onViolation
  ) as IGeneratorPipelineStage<TValue>;

export const runSyncPipeline = <TValue>(
  stages: readonly ISyncPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  onViolation: IMiddlewarePipelineViolationHandler
): void =>
  runSyncMiddleware(stages as readonly ISyncMiddlewareStage<TValue>[], value, done, onViolation);

export const runAsyncPipeline = <TValue>(
  stages: readonly IAsyncPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void | Promise<void>,
  onViolation: IMiddlewarePipelineViolationHandler,
  assertActive?: () => void
): Promise<void> =>
  runAsyncMiddleware(stages as readonly IAsyncMiddlewareStage<TValue>[], value, done, {
    onViolation,
    assertActive,
    combineStageAndDownstreamError: (stageError, downstreamError) =>
      tagPluginHostError(
        new AggregateError(
          [stageError, downstreamError],
          ERROR_TEXT.PIPELINE_STAGE_AND_DOWNSTREAM_FAILED
        ),
        PluginHostErrorCode.pipelineFailed
      )
  });

export const runGeneratorPipeline = <TValue>(
  stages: readonly IGeneratorPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void
): void =>
  runGeneratorMiddleware(
    stages as readonly IGeneratorMiddlewareStage<TValue>[],
    value,
    done,
    PLUGIN_HOST_GENERATOR_SIGNALS
  );

export const runPipeline = <TValue>(
  mode: IPipelineMode,
  stages: readonly (
    | ISyncPipelineStage<TValue>
    | IAsyncPipelineStage<TValue>
    | IGeneratorPipelineStage<TValue>
  )[],
  value: TValue,
  done: (value: TValue) => void,
  onViolation: IMiddlewarePipelineViolationHandler,
  assertActive?: () => void
): void | Promise<void> => {
  if (mode === PluginHostPipelineMode.sync)
    return runSyncPipeline(
      stages as readonly ISyncPipelineStage<TValue>[],
      value,
      done,
      onViolation
    );
  if (mode === PluginHostPipelineMode.async)
    return runAsyncPipeline(
      stages as readonly IAsyncPipelineStage<TValue>[],
      value,
      done,
      onViolation,
      assertActive
    );
  return runGeneratorPipeline(stages as readonly IGeneratorPipelineStage<TValue>[], value, done);
};

export const registerStage = <TStage>(
  stages: TStage[],
  stage: TStage,
  track: (dispose: () => void) => void
): void => {
  if (typeof stage !== 'function')
    throw createPluginHostTypeError(ERROR_TEXT.PIPELINE_STAGE_MUST_BE_FUNCTION);
  stages.push(stage);
  const registrationIndex = stages.length - 1;
  track(() => {
    const index =
      stages[registrationIndex] === stage ? registrationIndex : stages.lastIndexOf(stage);
    if (index !== -1) stages.splice(index, 1);
  });
};
