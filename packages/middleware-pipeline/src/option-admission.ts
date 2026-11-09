import { MiddlewarePipelineErrorCode } from './error-code.ts'
import { MIDDLEWARE_PIPELINE_SOURCE } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import { MiddlewarePipelineNext } from './state-constants.ts'

import { MiddlewarePipelineErrorText } from './error-text.ts'
/** Pure next-policy admission preserves the same native error without constructing a mode runner. */
export function admitPipelineNext(value: unknown): MiddlewarePipelineNext {
  /** Omission alone selects the supported single-submission default. */
  const next = value === undefined ? MiddlewarePipelineNext.single : value
  if (next !== MiddlewarePipelineNext.single && next !== MiddlewarePipelineNext.multiple)
    throw attachErrorIdentity(new TypeError(MiddlewarePipelineErrorText.invalidOption), {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.invalidOption
    })
  return next
}
