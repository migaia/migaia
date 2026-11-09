import {
  MIDDLEWARE_PIPELINE_SOURCE,
  MiddlewarePipelineErrorCode,
  type IMiddlewarePipelineErrorCode
} from './error-code.ts'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  isNativeErrorValue,
  tryReadProperty
} from '@migaia/utils/error'
import { MiddlewarePipelineErrorText } from './error-text.ts'

/** Finish independent sync or lifted submissions without replacing a lone original failure. */
export function throwMiddlewarePipelineDownstreamFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1)
    throw attachErrorIdentity(
      new AggregateError(failures, MiddlewarePipelineErrorText.multipleDownstreamFailed),
      {
        source: MIDDLEWARE_PIPELINE_SOURCE,
        code: MiddlewarePipelineErrorCode.multipleDownstreamFailed
      }
    )
}

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
