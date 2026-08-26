import {
  adaptGeneratorStageToAsyncGenerator as adaptGeneratorToAsyncGenerator,
  adaptSyncStageToAsync as adaptAsync,
  adaptSyncStageToAsyncGenerator as adaptAsyncGenerator,
  adaptSyncStageToGenerator as adaptGenerator,
  runAsyncGeneratorMiddleware,
  runAsyncMiddleware,
  runGeneratorMiddleware,
  runSyncMiddleware,
  type IAsyncGeneratorMiddlewareStage,
  type IAsyncMiddlewareStage,
  type IGeneratorMiddlewareStage,
  type IMiddlewarePipelineAbortSignal,
  type IMiddlewarePipelineControlOptions,
  type IMiddlewarePipelineViolationHandler,
  type ISyncMiddlewareStage
} from '@migaia/middleware-pipeline'
import ERROR_TEXT, { createPluginHostTypeError, tagPluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPipelineMode,
  ISyncPipelineStage
} from './typing.js'
import { GENERATOR_CONTINUE, GENERATOR_HALT, GENERATOR_UNDEFINED } from './typing.js'
import { PluginHostPipelineMode } from './state-constants.js'

/** Preserves plugin-host's existing public Symbol identities while delegating the runner. */
const PLUGIN_HOST_GENERATOR_SIGNALS = {
  undefined: GENERATOR_UNDEFINED,
  halt: GENERATOR_HALT,
  continue: GENERATOR_CONTINUE
} as const

/** Compatibility adapter: plugin-host keeps its public stage names and error policy. */
export const adaptSyncStageToAsync = <TValue>(
  stage: ISyncPipelineStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler = () => {}
): IAsyncPipelineStage<TValue> =>
  adaptAsync(stage as ISyncMiddlewareStage<TValue>, onViolation) as IAsyncPipelineStage<TValue>

/** Compatibility adapter: plugin-host keeps its public stage names and sentinel contract. */
export const adaptSyncStageToGenerator = <TValue>(
  stage: ISyncPipelineStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler
): IGeneratorPipelineStage<TValue> =>
  adaptGenerator(
    stage as ISyncMiddlewareStage<TValue>,
    onViolation
  ) as IGeneratorPipelineStage<TValue>

/**
 * Promotes a plugin-host generator stage to async-generator without changing yield/terminal
 * identity.
 */
export const adaptGeneratorStageToAsyncGenerator = <TValue>(
  stage: IGeneratorPipelineStage<TValue>
): IAsyncGeneratorPipelineStage<TValue> =>
  adaptGeneratorToAsyncGenerator(
    stage as IGeneratorMiddlewareStage<TValue>
  ) as IAsyncGeneratorPipelineStage<TValue>

/**
 * Compatibility adapter: plugin-host keeps its public stage names, composed onto the generator
 * guard.
 */
export const adaptSyncStageToAsyncGenerator = <TValue>(
  stage: ISyncPipelineStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler
): IAsyncGeneratorPipelineStage<TValue> =>
  adaptAsyncGenerator(
    stage as ISyncMiddlewareStage<TValue>,
    onViolation
  ) as IAsyncGeneratorPipelineStage<TValue>

export const runSyncPipeline = <TValue>(
  stages: readonly ISyncPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  onViolation: IMiddlewarePipelineViolationHandler,
  control?: IMiddlewarePipelineControlOptions
): void =>
  runSyncMiddleware(
    stages as readonly ISyncMiddlewareStage<TValue>[],
    value,
    done,
    onViolation,
    control
  )

export const runAsyncPipeline = <TValue>(
  stages: readonly IAsyncPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void | Promise<void>,
  onViolation: IMiddlewarePipelineViolationHandler,
  assertActive?: () => void,
  signal?: IMiddlewarePipelineAbortSignal
): Promise<void> =>
  runAsyncMiddleware(stages as readonly IAsyncMiddlewareStage<TValue>[], value, done, {
    onViolation,
    assertActive,
    signal,
    combineStageAndDownstreamError: (stageError, downstreamError) =>
      tagPluginHostError(
        new AggregateError(
          [stageError, downstreamError],
          ERROR_TEXT.PIPELINE_STAGE_AND_DOWNSTREAM_FAILED
        ),
        PluginHostErrorCode.pipelineFailed
      )
  })

export const runGeneratorPipeline = <TValue>(
  stages: readonly IGeneratorPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void,
  control?: IMiddlewarePipelineControlOptions
): void =>
  runGeneratorMiddleware(
    stages as readonly IGeneratorMiddlewareStage<TValue>[],
    value,
    done,
    PLUGIN_HOST_GENERATOR_SIGNALS,
    control
  )

export const runAsyncGeneratorPipeline = <TValue>(
  stages: readonly IAsyncGeneratorPipelineStage<TValue>[],
  value: TValue,
  done: (value: TValue) => void | Promise<void>,
  control?: IMiddlewarePipelineControlOptions
): Promise<void> =>
  runAsyncGeneratorMiddleware(
    stages as readonly IAsyncGeneratorMiddlewareStage<TValue>[],
    value,
    done,
    PLUGIN_HOST_GENERATOR_SIGNALS,
    control
  )

export const runPipeline = <TValue>(
  mode: IPipelineMode,
  stages: readonly (
    | ISyncPipelineStage<TValue>
    | IAsyncPipelineStage<TValue>
    | IGeneratorPipelineStage<TValue>
    | IAsyncGeneratorPipelineStage<TValue>
  )[],
  value: TValue,
  done: (value: TValue) => void,
  onViolation: IMiddlewarePipelineViolationHandler,
  assertActive?: () => void,
  signal?: IMiddlewarePipelineAbortSignal
): void | Promise<void> => {
  if (mode === PluginHostPipelineMode.sync)
    return runSyncPipeline(
      stages as readonly ISyncPipelineStage<TValue>[],
      value,
      done,
      onViolation,
      signal ? { signal } : undefined
    )
  if (mode === PluginHostPipelineMode.async)
    return runAsyncPipeline(
      stages as readonly IAsyncPipelineStage<TValue>[],
      value,
      done,
      onViolation,
      assertActive,
      signal
    )
  if (mode === PluginHostPipelineMode.generator)
    return runGeneratorPipeline(
      stages as readonly IGeneratorPipelineStage<TValue>[],
      value,
      done,
      signal ? { signal } : undefined
    )
  return runAsyncGeneratorPipeline(
    stages as readonly IAsyncGeneratorPipelineStage<TValue>[],
    value,
    done,
    signal ? { signal } : undefined
  )
}

export const registerStage = <TStage>(
  stages: TStage[],
  stage: TStage,
  track: (dispose: () => void) => void
): void => {
  if (typeof stage !== 'function')
    throw createPluginHostTypeError(ERROR_TEXT.PIPELINE_STAGE_MUST_BE_FUNCTION)
  stages.push(stage)
  const registrationIndex = stages.length - 1
  track(() => {
    const index =
      stages[registrationIndex] === stage ? registrationIndex : stages.lastIndexOf(stage)
    if (index !== -1) stages.splice(index, 1)
  })
}
