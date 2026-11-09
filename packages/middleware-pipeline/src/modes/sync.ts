import { MiddlewarePipelineErrorCode } from '../error-code.ts'
import { MIDDLEWARE_PIPELINE_SOURCE } from '../error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import type { IMiddlewarePipelineContext, ISyncMiddlewareStage } from '../runtime-types.ts'

import { runSyncMiddleware } from '../runners/sync.ts'
import { definePipelineMode } from '../mode-registry.ts'
import { selectSignal } from '../create-pipeline.ts'
import { MiddlewarePipelineMode } from '../state-constants.ts'

import { MiddlewarePipelineErrorText } from '../error-text.ts'
/** Real sync runner and lift behavior, installed only through this identity. */
export const syncMode = /* @__PURE__ */ definePipelineMode({
  key: MiddlewarePipelineMode.sync,
  run(options, stages, value, done, control) {
    /** Sync mode keeps malformed control failures synchronous. */
    const signal = selectSignal(options, control)
    return runSyncMiddleware(
      stages as readonly ISyncMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void,
      options.onViolation,
      signal,
      options.assertActive,
      options.next
    )
  },
  lift(_from, _stage, _options) {
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.unsupportedLift), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  }
})
