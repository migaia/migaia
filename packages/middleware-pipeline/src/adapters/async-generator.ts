import type {
  ISyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  IAsyncGeneratorMiddlewareStage
} from '../runtime-types.ts'
import { invokeWithContext } from '../runtime-context.ts'
import {
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineNext,
  type IGeneratorMiddlewareSignals,
  type IMiddlewarePipelineViolationHandler
} from '../state-constants.ts'

import { adaptSyncStageToGenerator } from '../adapters/generator.ts'
export const adaptGeneratorStageToAsyncGenerator = <
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
>(
  stage: IGeneratorMiddlewareStage<TValue, TSignals>
): IAsyncGeneratorMiddlewareStage<TValue, TSignals> =>
  async function* (value, context) {
    return yield* invokeWithContext(stage, value, context)
  }

/** Promotes a sync next-style stage through the canonical sync-to-generator violation guard. */
export const adaptSyncStageToAsyncGenerator = <
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler,
  signals: TSignals = MiddlewarePipelineGeneratorSignals as TSignals,
  nextPolicy: MiddlewarePipelineNext = MiddlewarePipelineNext.single
): IAsyncGeneratorMiddlewareStage<TValue, TSignals> =>
  adaptGeneratorStageToAsyncGenerator(
    adaptSyncStageToGenerator(stage, onViolation, signals, nextPolicy)
  )

/** Runs a synchronous stage sequence with one admitted signal and synchronous failure timing. */
