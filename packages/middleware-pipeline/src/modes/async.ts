import { MiddlewarePipelineErrorCode } from '../error-code.ts'
import { MIDDLEWARE_PIPELINE_SOURCE } from '../error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import type { IAbortSignal } from '@migaia/utils/promise'
import type {
  IMiddlewarePipelineContext,
  ISyncMiddlewareStage,
  IAsyncMiddlewareStage
} from '../runtime-types.ts'

import { runAsyncPipeline } from '../runners/async.ts'
import { definePipelineMode } from '../mode-registry.ts'
import { selectSignal } from '../create-pipeline.ts'
import { MiddlewarePipelineMode } from '../state-constants.ts'

import { MiddlewarePipelineErrorText } from '../error-text.ts'
import { adaptSyncStageToAsync } from '../adapters/async.ts'
/** Real async runner and lift behavior, installed only through this identity. */
export const asyncMode = /* @__PURE__ */ definePipelineMode({
  key: MiddlewarePipelineMode.async,
  run(options, stages, value, done, control) {
    /** Async mode converts malformed control admission into a rejected Promise. */
    let signal: IAbortSignal | undefined
    try {
      signal = selectSignal(options, control)
    } catch (error) {
      return Promise.reject(error)
    }
    return runAsyncPipeline(
      stages as readonly IAsyncMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void | Promise<void>,
      {
        onViolation: options.onViolation,
        next: options.next,
        assertActive: options.assertActive,
        combineStageAndDownstreamError: options.combineStageAndDownstreamError,
        signal
      }
    )
  },
  lift(from, stage, options) {
    if (from === 'sync')
      return adaptSyncStageToAsync(
        stage as ISyncMiddlewareStage<unknown>,
        options.onViolation,
        options.next
      )
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.unsupportedLift), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  }
})
