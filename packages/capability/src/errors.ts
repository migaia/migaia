import { ERROR_SOURCE } from './error-code.ts'
/** `source` value stamped onto every error this package throws. */
export const CAPABILITY_SOURCE = ERROR_SOURCE

import { attachErrorIdentity } from '@migaia/utils/error'

/**
 * Shared error identity for the capability boundary. Source and code are attached as properties
 * without replacing the error. Checks such as `instanceof TypeError` and `instanceof RangeError`
 * keep their meaning.
 */
export type ICapabilityError = Error & {
  readonly source: string
  readonly code: string
}

/** Creates an `Error` with `(source, code)` and preserves the stack captured by its constructor. */
export function createCapabilityError(
  code: string,
  message: string,
  options?: { readonly cause?: unknown }
): ICapabilityError {
  const error = new Error(
    message,
    options !== undefined && 'cause' in options ? { cause: options.cause } : undefined
  )
  return attachErrorIdentity(error, { source: CAPABILITY_SOURCE, code }) as ICapabilityError
}

/**
 * Attaches `(source, code)` to an existing error without changing `message`, `name`, or other
 * fields. Use this when callers rely on the native error type instead of a plain `Error`.
 * `INVALID_NAME`, `INVALID_ACTIVATE`, and `INVALID_HANDLE` retain their `TypeError` identity.
 */
export function tagCapabilityError<E extends Error>(error: E, code: string): E {
  return attachErrorIdentity(error, { source: CAPABILITY_SOURCE, code })
}
