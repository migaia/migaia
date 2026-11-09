import { MiddlewarePipelineErrorCode } from '../error-code.ts'
import { MIDDLEWARE_PIPELINE_SOURCE } from '../error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import type {
  IMiddlewarePipelineContext,
  ISyncMiddlewareStage,
  IGeneratorMiddlewareStage,
  IAsyncGeneratorMiddlewareStage
} from '../runtime-types.ts'

import { runAsyncGeneratorMiddleware } from '../runners/async-generator.ts'
import { definePipelineMode } from '../mode-registry.ts'
import { selectSignal } from '../create-pipeline.ts'
import { MiddlewarePipelineMode } from '../state-constants.ts'

import { MiddlewarePipelineErrorText } from '../error-text.ts'
import {
  adaptSyncStageToAsyncGenerator,
  adaptGeneratorStageToAsyncGenerator
} from '../adapters/async-generator.ts'
/** Real async-generator runner and lift behavior, installed only through this identity. */
export const asyncGeneratorMode = /* @__PURE__ */ definePipelineMode({
  key: MiddlewarePipelineMode.asyncGenerator,
  run(options, stages, value, done, control) {
    try {
      /** Async-generator mode converts malformed control admission into a rejected Promise. */
      const signal = selectSignal(options, control)
      return runAsyncGeneratorMiddleware(
        stages as readonly IAsyncGeneratorMiddlewareStage<unknown>[],
        value,
        done as (value: unknown, context?: IMiddlewarePipelineContext) => void | Promise<void>,
        options.signals,
        signal,
        options.assertActive,
        options.next
      )
    } catch (error) {
      return Promise.reject(error)
    }
  },
  lift(from, stage, options) {
    if (from === 'sync')
      return adaptSyncStageToAsyncGenerator(
        stage as ISyncMiddlewareStage<unknown>,
        options.onViolation,
        options.signals,
        options.next
      )
    if (from === 'generator')
      return adaptGeneratorStageToAsyncGenerator(stage as IGeneratorMiddlewareStage<unknown>)
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.unsupportedLift), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  }
})
