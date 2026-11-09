import type { ISyncMiddlewareStage, IGeneratorMiddlewareStage } from '../runtime-types.ts'
import { invokeStageWithContext } from '../runtime-context.ts'
import {
  MiddlewarePipelineGeneratorSignals,
  MiddlewarePipelineNext,
  type IGeneratorMiddlewareSignals,
  type IMiddlewarePipelineViolationHandler
} from '../state-constants.ts'
import { throwMiddlewarePipelineDownstreamFailures } from '../errors.ts'
import { PipelineSubmissions } from '../pipeline-submissions.ts'
export const adaptSyncStageToGenerator = <
  TValue,
  TSignals extends IGeneratorMiddlewareSignals = typeof MiddlewarePipelineGeneratorSignals
>(
  stage: ISyncMiddlewareStage<TValue>,
  onViolation: IMiddlewarePipelineViolationHandler,
  signals: TSignals = MiddlewarePipelineGeneratorSignals as TSignals,
  nextPolicy: MiddlewarePipelineNext = MiddlewarePipelineNext.single
): IGeneratorMiddlewareStage<TValue, TSignals> =>
  function* (value, context) {
    /** Sync stage side effects complete before any yielded value reaches downstream. */
    const submissions = new PipelineSubmissions<TValue>(nextPolicy, onViolation)
    try {
      invokeStageWithContext(stage, value, submissions.next, context)
    } finally {
      submissions.close()
    }
    if (submissions.count === 0) return signals.halt
    /** Throw-back belongs to the adapter because the originating sync stage has already returned. */
    const failures: unknown[] = []
    for (let index = 0; index < submissions.count; index += 1) {
      try {
        yield submissions.at(index)
      } catch (error) {
        if (nextPolicy === MiddlewarePipelineNext.single) throw error
        failures.push(error)
      }
    }
    throwMiddlewarePipelineDownstreamFailures(failures)
    return signals.continue
  }

/** Promotes a synchronous generator by delegating its yields and terminal signal. */
