import {
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  type IMiddlewarePipelineErrorCode
} from './error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import { MiddlewarePipelineErrorText } from './error-text.js'

/**
 * Preserves both original stage and downstream errors and attaches the package-boundary identity to
 * the default `AggregateError`.
 */
export const createMiddlewarePipelineExecutionError = (
  stageError: unknown,
  downstreamError: unknown
): AggregateError & {
  readonly source: typeof MIDDLEWARE_PIPELINE_SOURCE
  readonly code: IMiddlewarePipelineErrorCode
} => {
  /** AggregateError is retained so both original failures remain identity-reachable. */
  const error = new AggregateError(
    [stageError, downstreamError],
    MiddlewarePipelineErrorText.executionFailed
  )
  return attachErrorIdentity(error, {
    source: MIDDLEWARE_PIPELINE_SOURCE,
    code: MiddlewarePipelineErrorCode.executionFailed
  }) as AggregateError & {
    readonly source: typeof MIDDLEWARE_PIPELINE_SOURCE
    readonly code: IMiddlewarePipelineErrorCode
  }
}
