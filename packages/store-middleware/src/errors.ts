import {
  ERROR_SOURCE,
  StoreMiddlewareErrorCode,
  type IStoreMiddlewareErrorCode
} from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'

export { StoreMiddlewareErrorCode, type IStoreMiddlewareErrorCode }

/** `source` assigned by this package’s factories; upstream errors keep their actual owner. */
export const STORE_MIDDLEWARE_SOURCE = ERROR_SOURCE

function tagStoreMiddlewareError<E extends Error>(error: E, code: IStoreMiddlewareErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_MIDDLEWARE_SOURCE, code })
}

/**
 * Return a new native Error with the supplied code/message and package source, without throwing. An
 * own cause option is retained even when undefined; the constructor-created stack stays intact.
 */
export function createStoreMiddlewareError(
  code: IStoreMiddlewareErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options !== undefined && Object.hasOwn(options, 'cause') ? { cause: options.cause } : undefined
  )
  return tagStoreMiddlewareError(error, code)
}

/**
 * Return a native AggregateError with the supplied code/message and original errors in order. It
 * retains each value's identity and stack through errors, without throwing or adding a cause.
 */
export function createStoreMiddlewareAggregateError(
  code: IStoreMiddlewareErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreMiddlewareError(new AggregateError(errors, message), code)
}
