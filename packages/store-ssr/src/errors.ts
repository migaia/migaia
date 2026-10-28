import { ERROR_SOURCE, StoreSsrErrorCode, type IStoreSsrErrorCode } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'

export { StoreSsrErrorCode, type IStoreSsrErrorCode }

/** Identity for package-owned failures; complete foreign identities retain their existing source. */
export const STORE_SSR_SOURCE = ERROR_SOURCE

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
const tagStoreSsrError = <E extends Error>(error: E, code: IStoreSsrErrorCode): E =>
  attachErrorIdentity(error, { source: STORE_SSR_SOURCE, code })

/**
 * Create an SSR-owned Error for the supplied stable code and display text. An optional nonundefined
 * cause remains reachable by identity; the native stack is generated normally and never rewritten.
 */
export function createStoreSsrError(
  code: IStoreSsrErrorCode,
  message: string,
  options?: {
    /** Optional original failure; omitted/undefined leaves the Error without an own cause field. */
    readonly cause?: unknown
  }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreSsrError(error, code)
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreSsrRangeError(code: IStoreSsrErrorCode, message: string): RangeError {
  return tagStoreSsrError(new RangeError(message), code)
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStoreSsrTypeError(code: IStoreSsrErrorCode, message: string): TypeError {
  return tagStoreSsrError(new TypeError(message), code)
}

/** Builds a `(source, code)`-tagged `AggregateError`; `errors[]` stays reachable. */
export function createStoreSsrAggregateError(
  code: IStoreSsrErrorCode,
  errors: unknown[],
  message: string
): AggregateError {
  return tagStoreSsrError(new AggregateError(errors, message), code)
}
