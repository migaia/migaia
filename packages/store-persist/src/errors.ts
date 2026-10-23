import { ERROR_SOURCE, StorePersistErrorCode, type IStorePersistErrorCode } from './error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'

export { StorePersistErrorCode, type IStorePersistErrorCode }

/**
 * Source stamped on locally constructed errors; forwarded unit/codec/adapter failures keep their
 * owner.
 */
export const STORE_PERSIST_SOURCE = ERROR_SOURCE

function tagStorePersistError<E extends Error>(error: E, code: IStorePersistErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_PERSIST_SOURCE, code })
}

/**
 * Constructs a tagged native Error for an explicit code/message without rewriting its stack. A
 * defined options.cause is retained by identity; this creates a new error rather than tagging an
 * existing exception. Ordinary persistence users usually inspect handle outcomes instead.
 */
export function createStorePersistError(
  code: IStorePersistErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStorePersistError(error, code)
}

/**
 * Constructs a tagged native DOMException named AbortError for cancellation after disposal. A
 * defined cause is attached by identity; the declared return type is Error, while runtime callers
 * can still recognize DOMException and its native stack.
 */
export function createStorePersistAbortError(
  code: IStorePersistErrorCode,
  message: string,
  cause?: unknown
): Error {
  const error = new DOMException(message, 'AbortError')
  if (cause !== undefined)
    Object.defineProperty(error, 'cause', { value: cause, configurable: true })
  return tagStorePersistError(error, code)
}

/** Constructs a tagged native TypeError, retaining a defined cause without rewriting either stack. */
export function createStorePersistTypeError(
  code: IStorePersistErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError {
  const error = new TypeError(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStorePersistError(error, code)
}

/**
 * Constructs a tagged native AggregateError retaining supplied failure order and identities in
 * errors. Use for combined failures; no deduplication or replacement of the original errors
 * occurs.
 */
export function createStorePersistAggregateError(
  code: IStorePersistErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStorePersistError(new AggregateError(errors, message), code)
}
