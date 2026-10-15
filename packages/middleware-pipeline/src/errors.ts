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

/** Owns all package invalid-option errors while preserving each caller's cause shape. */
export const createMiddlewarePipelineInvalidOptionError = (
  message: string,
  options?: ErrorOptions
): TypeError =>
  attachErrorIdentity(new TypeError(message, options), {
    source: MIDDLEWARE_PIPELINE_SOURCE,
    code: MiddlewarePipelineErrorCode.invalidOption
  }) as TypeError

/** Preserves Error abort reasons and tags package-created primitive-reason failures. */
export const createMiddlewarePipelineAbortError = (reason: unknown): Error => {
  if (reason instanceof Error) return reason
  return attachErrorIdentity(new Error(MiddlewarePipelineErrorText.aborted, { cause: reason }), {
    source: MIDDLEWARE_PIPELINE_SOURCE,
    code: MiddlewarePipelineErrorCode.aborted
  }) as Error
}

/** Builds the fixed primary-first abort cleanup aggregate. */
export const createMiddlewarePipelineAbortCleanupError = (
  abortFailure: unknown,
  cleanupFailure: unknown
): AggregateError =>
  attachErrorIdentity(
    new AggregateError(
      [abortFailure, cleanupFailure],
      MiddlewarePipelineErrorText.abortCleanupFailed
    ),
    { source: MIDDLEWARE_PIPELINE_SOURCE, code: MiddlewarePipelineErrorCode.abortCleanupFailed }
  ) as AggregateError
