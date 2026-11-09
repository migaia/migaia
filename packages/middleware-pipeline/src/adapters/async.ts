import type { ISyncMiddlewareStage, IAsyncMiddlewareStage } from '../runtime-types.ts'
import { invokeStageWithContext } from '../runtime-context.ts'
import {
  MiddlewarePipelineNext,
  type IMiddlewarePipelineViolationHandler
} from '../state-constants.ts'
import { throwMiddlewarePipelineDownstreamFailures } from '../errors.ts'
import { PipelineSubmissions } from '../pipeline-submissions.ts'
export const adaptSyncStageToAsync =
  <TValue>(
    stage: ISyncMiddlewareStage<TValue>,
    onViolation: IMiddlewarePipelineViolationHandler,
    nextPolicy: MiddlewarePipelineNext = MiddlewarePipelineNext.single
  ): IAsyncMiddlewareStage<TValue> =>
  async (value, next, context) => {
    /** Local submissions preserve synchronous stage timing under async lifting. */
    const submissions = new PipelineSubmissions<TValue>(nextPolicy, onViolation)
    try {
      invokeStageWithContext(stage, value, submissions.next, context)
    } finally {
      submissions.close()
    }
    /** A lifted sync stage cannot handle suffix errors, so all its registered values still run. */
    const failures: unknown[] = []
    for (let index = 0; index < submissions.count; index += 1) {
      try {
        await next(submissions.at(index))
      } catch (error) {
        if (nextPolicy === MiddlewarePipelineNext.single) throw error
        failures.push(error)
      }
    }
    throwMiddlewarePipelineDownstreamFailures(failures)
  }

/** Adapts sync submissions through the same generator continuation protocol. */
