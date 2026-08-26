import { attachErrorIdentity } from '@migaia/utils/error'
import { MIDDLEWARE_PIPELINE_SOURCE, MiddlewarePipelineErrorCode } from './error-code.js'
import { MiddlewarePipelineSignalText } from './signal-text.js'

/** Creates tagged admission error without loading async execution error text. */
export const createMiddlewarePipelineInvalidOptionError = (cause?: unknown): TypeError =>
  attachErrorIdentity(new TypeError(MiddlewarePipelineSignalText.invalidOption, { cause }), {
    source: MIDDLEWARE_PIPELINE_SOURCE,
    code: MiddlewarePipelineErrorCode.invalidOption
  }) as TypeError

/** Preserves Error abort reasons and tags package-created primitive-reason failures. */
export const createMiddlewarePipelineAbortError = (reason: unknown): Error => {
  if (reason instanceof Error) return reason
  return attachErrorIdentity(new Error(MiddlewarePipelineSignalText.aborted, { cause: reason }), {
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
      MiddlewarePipelineSignalText.abortCleanupFailed
    ),
    { source: MIDDLEWARE_PIPELINE_SOURCE, code: MiddlewarePipelineErrorCode.abortCleanupFailed }
  ) as AggregateError
