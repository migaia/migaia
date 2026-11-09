import { MiddlewarePipelineErrorCode } from '../error-code.ts'
import { MIDDLEWARE_PIPELINE_SOURCE } from '../error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import type {
  IMiddlewarePipelineContext,
  ISyncMiddlewareStage,
  IGeneratorMiddlewareStage
} from '../runtime-types.ts'

import { runGeneratorMiddleware } from '../runners/generator.ts'
import { definePipelineMode } from '../mode-registry.ts'
import { selectSignal } from '../create-pipeline.ts'
import { MiddlewarePipelineMode } from '../state-constants.ts'

import { MiddlewarePipelineErrorText } from '../error-text.ts'
import { adaptSyncStageToGenerator } from '../adapters/generator.ts'
/** Real generator runner and lift behavior, installed only through this identity. */
export const generatorMode = /* @__PURE__ */ definePipelineMode({
  key: MiddlewarePipelineMode.generator,
  run(options, stages, value, done, control) {
    /** Generator mode keeps malformed control failures synchronous. */
    const signal = selectSignal(options, control)
    return runGeneratorMiddleware(
      stages as readonly IGeneratorMiddlewareStage<unknown>[],
      value,
      done as (value: unknown, context?: IMiddlewarePipelineContext) => void,
      options.signals,
      signal,
      options.assertActive,
      options.next
    )
  },
  lift(from, stage, options) {
    if (from === 'sync')
      return adaptSyncStageToGenerator(
        stage as ISyncMiddlewareStage<unknown>,
        options.onViolation,
        options.signals,
        options.next
      )
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.unsupportedLift), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  }
})
