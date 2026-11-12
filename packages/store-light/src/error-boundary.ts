import { identifyBoundaryFailure } from '@migaia/utils/error'
import { createStoreLightError, STORE_LIGHT_SOURCE, type IStoreLightErrorCode } from './errors.ts'

/** Preserve native/foreign identity; classify unowned failures without dropping the original value. */
export const identifyStoreLightFailure = (
  error: unknown,
  code: IStoreLightErrorCode,
  text: string
): Error => {
  return identifyBoundaryFailure(error, { source: STORE_LIGHT_SOURCE, code }, (cause) =>
    createStoreLightError(code, text, { cause })
  ) as Error
}
