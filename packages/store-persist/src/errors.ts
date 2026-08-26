import { StorePersistErrorCode, type IStorePersistErrorCode } from './error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'

export { StorePersistErrorCode, type IStorePersistErrorCode }

/** `source` value stamped onto every error this package throws. */
export const STORE_PERSIST_SOURCE = '@migaia/store-persist'

function tagStorePersistError<E extends Error>(error: E, code: IStorePersistErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_PERSIST_SOURCE, code })
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
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

/** Builds a tagged native DOMException for cancellation after disposal. */
export function createStorePersistAbortError(
  code: IStorePersistErrorCode,
  message: string,
  cause?: unknown
): DOMException {
  const error = new DOMException(message, 'AbortError')
  if (cause !== undefined)
    Object.defineProperty(error, 'cause', { value: cause, configurable: true })
  return tagStorePersistError(error, code)
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
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

/** Builds a `(source, code)`-tagged `AggregateError`, preserving `errors[]` as a cause path. */
export function createStorePersistAggregateError(
  code: IStorePersistErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStorePersistError(new AggregateError(errors, message), code)
}
