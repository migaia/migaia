import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'
import {
  createStoreLightAggregateError,
  createStoreLightError,
  STORE_LIGHT_SOURCE,
  type IStoreLightErrorCode
} from './errors.js'

/** Preserve native/foreign identity; classify unowned failures without dropping the original value. */
export const identifyStoreLightFailure = (
  error: unknown,
  code: IStoreLightErrorCode,
  text: string
): Error => {
  if (isNativeErrorValue(error)) {
    try {
      /** Inspect metadata without invoking accessors on an application-owned error. */
      const source = Object.getOwnPropertyDescriptor(error, 'source')
      /** A complete existing identity stays with its original owner. */
      const existingCode = Object.getOwnPropertyDescriptor(error, 'code')
      if (typeof source?.value === 'string' && typeof existingCode?.value === 'string') return error
      if (source === undefined && existingCode === undefined && Object.isExtensible(error))
        return attachErrorIdentity(error, { source: STORE_LIGHT_SOURCE, code })
    } catch (metadataFailure) {
      return createStoreLightAggregateError(code, [error, metadataFailure], text)
    }
  }
  return createStoreLightError(code, text, { cause: error })
}
