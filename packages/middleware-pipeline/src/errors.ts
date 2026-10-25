import {
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  type IMiddlewarePipelineErrorCode
} from './error-code.js'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  isNativeErrorValue,
  tryReadProperty
} from '@migaia/utils/error'
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

/** Preserves independent branch errors in their submission order. */
export const createMiddlewarePipelineMultipleDownstreamError = (
  errors: readonly unknown[]
): AggregateError =>
  attachErrorIdentity(
    new AggregateError(errors, MiddlewarePipelineErrorText.multipleDownstreamFailed),
    {
      source: MIDDLEWARE_PIPELINE_SOURCE,
      code: MiddlewarePipelineErrorCode.multipleDownstreamFailed
    }
  ) as AggregateError

/** Owns all package invalid-option errors while preserving each caller's cause shape. */
export const createMiddlewarePipelineInvalidOptionError = (
  message: string,
  options?: ErrorOptions
): TypeError =>
  attachErrorIdentity(new TypeError(message, options), {
    source: MIDDLEWARE_PIPELINE_SOURCE,
    code: MiddlewarePipelineErrorCode.invalidOption
  }) as TypeError

/**
 * Classifies otherwise uncoded boundary failures without replacing native errors or existing
 * package owners.
 */
export function identifyMiddlewarePipelineFailure(
  error: unknown,
  code: IMiddlewarePipelineErrorCode = MiddlewarePipelineErrorCode.executionFailed
): Error {
  if (isNativeErrorValue(error)) {
    /** A complete semantic identity remains owned by the original package. */
    const source = tryReadProperty(error as { source?: unknown }, 'source')
    /** A host's numeric code alone is not a semantic package identity. */
    const existingCode = tryReadProperty(error as { code?: unknown }, 'code')
    if (
      !source.threw &&
      !existingCode.threw &&
      typeof source.value === 'string' &&
      source.value.length > 0 &&
      typeof existingCode.value === 'string' &&
      existingCode.value.length > 0
    )
      return error
    try {
      return attachErrorIdentity(error, { source: MIDDLEWARE_PIPELINE_SOURCE, code })
    } catch (attachmentFailure) {
      /** Immutable or conflicting native errors retain their original stack and identity on cause. */
      const wrapper = attachErrorIdentity(
        new Error(MiddlewarePipelineErrorText.executionFailed, { cause: error }),
        { source: MIDDLEWARE_PIPELINE_SOURCE, code }
      )
      return attachSecondaryErrors(wrapper, [attachmentFailure]) as Error
    }
  }
  return attachErrorIdentity(
    new Error(MiddlewarePipelineErrorText.executionFailed, { cause: error }),
    { source: MIDDLEWARE_PIPELINE_SOURCE, code }
  )
}

/** Preserves Error abort reasons and tags package-created primitive-reason failures. */
export const createMiddlewarePipelineAbortError = (reason: unknown): Error => {
  if (reason instanceof Error)
    return identifyMiddlewarePipelineFailure(reason, MiddlewarePipelineErrorCode.aborted)
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
