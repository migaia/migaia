import { ERROR_SOURCE, StoreIndexedErrorCode, type IStoreIndexedErrorCode } from './error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'

export { StoreIndexedErrorCode, type IStoreIndexedErrorCode }

/** Source attached to package-owned failures; already identified callback failures keep their owner. */
export const STORE_INDEXED_SOURCE = ERROR_SOURCE

function tagStoreIndexedError<E extends Error>(error: E, code: IStoreIndexedErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_INDEXED_SOURCE, code })
}

/**
 * Create an Error for an extension boundary with the supplied code/message and package source. An
 * own cause option is retained even when undefined; the new error keeps its constructor stack.
 */
export function createStoreIndexedError(
  code: IStoreIndexedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options !== undefined && Object.hasOwn(options, 'cause') ? { cause: options.cause } : undefined
  )
  return tagStoreIndexedError(error, code)
}

/**
 * Create a RangeError with the supplied code/message and package source, preserving its native
 * type.
 */
export function createStoreIndexedRangeError(
  code: IStoreIndexedErrorCode,
  message: string
): RangeError {
  return tagStoreIndexedError(new RangeError(message), code)
}

/**
 * Create a TypeError with the supplied code/message and package source, preserving its native type.
 * A defined cause is retained by reference; an omitted or undefined cause option is not installed.
 */
export function createStoreIndexedTypeError(
  code: IStoreIndexedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError {
  const error = new TypeError(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreIndexedError(error, code)
}
