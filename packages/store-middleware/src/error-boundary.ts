import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'
import {
  createStoreMiddlewareError,
  createStoreMiddlewareAggregateError,
  STORE_MIDDLEWARE_SOURCE
} from './errors.js'
import { StoreMiddlewareErrorCode, type IStoreMiddlewareErrorCode } from './error-code.js'
import { StoreMiddlewareErrorText } from './error-text.js'

/**
 * Gives this domain boundary an identity while preserving native errors and existing package
 * owners.
 */
export function identifyMiddlewareFailure(
  error: unknown,
  code: IStoreMiddlewareErrorCode = StoreMiddlewareErrorCode.callbackFailed,
  text: string = StoreMiddlewareErrorText.callbackFailed
): Error {
  if (isNativeErrorValue(error)) {
    try {
      /** Own descriptors avoid invoking application error metadata accessors. */
      const source = Object.getOwnPropertyDescriptor(error, 'source')
      /** A complete upstream identity keeps its existing package semantics. */
      const existingCode = Object.getOwnPropertyDescriptor(error, 'code')
      if (typeof source?.value === 'string' && typeof existingCode?.value === 'string') return error
      if (!source && !existingCode && Object.isExtensible(error))
        return attachErrorIdentity(error, { source: STORE_MIDDLEWARE_SOURCE, code })
    } catch (metadataError) {
      return createStoreMiddlewareAggregateError(code, [error, metadataError], text)
    }
  }
  return createStoreMiddlewareError(code, text, { cause: error })
}
