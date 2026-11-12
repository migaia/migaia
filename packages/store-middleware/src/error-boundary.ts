import { identifyBoundaryFailure } from '@migaia/utils/error'
import { createStoreMiddlewareError, STORE_MIDDLEWARE_SOURCE } from './errors.ts'
import { StoreMiddlewareErrorCode, type IStoreMiddlewareErrorCode } from './error-code.ts'
import { StoreMiddlewareErrorText } from './error-text.ts'

/**
 * Gives this domain boundary an identity while preserving native errors and existing package
 * owners.
 */
export function identifyMiddlewareFailure(
  error: unknown,
  code: IStoreMiddlewareErrorCode = StoreMiddlewareErrorCode.callbackFailed,
  text: string = StoreMiddlewareErrorText.callbackFailed
): Error {
  return identifyBoundaryFailure(error, { source: STORE_MIDDLEWARE_SOURCE, code }, (cause) =>
    createStoreMiddlewareError(code, text, { cause })
  ) as Error
}
