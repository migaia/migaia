import { StoreKeyedErrorText } from './error-text.ts'
import { ERROR_SOURCE, StoreKeyedErrorCode, type IStoreKeyedErrorCode } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'

export { StoreKeyedErrorCode, type IStoreKeyedErrorCode }

/**
 * `source` assigned by this package’s factories; errors owned by another package retain their
 * owner.
 */
export const STORE_KEYED_SOURCE = ERROR_SOURCE

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreKeyedError<E extends Error>(error: E, code: IStoreKeyedErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_KEYED_SOURCE, code })
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreKeyedError(
  code: IStoreKeyedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options !== undefined && Object.hasOwn(options, 'cause') ? { cause: options.cause } : undefined
  )
  return tagStoreKeyedError(error, code)
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreKeyedRangeError(
  code: IStoreKeyedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): RangeError {
  return tagStoreKeyedError(
    new RangeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code
  )
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStoreKeyedTypeError(
  code: IStoreKeyedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError {
  return tagStoreKeyedError(
    new TypeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code
  )
}

/** Builds a `(source, code)`-tagged `AggregateError`; `errors[]` stays reachable. */
export function createStoreKeyedAggregateError(
  code: IStoreKeyedErrorCode,
  errors: unknown[],
  message: string
): AggregateError {
  return tagStoreKeyedError(new AggregateError(errors, message), code)
}

/**
 * Run an atom `create()` or derived `read` callback. A thrown error that already has a complete
 * source/code identity passes through; anything else becomes CALLBACK_FAILED with it on `cause`.
 */
export function runAtomCallback<T>(callback: () => T): T {
  try {
    return callback()
  } catch (error) {
    throw toAtomCallbackFailure(error)
  }
}

/** The error a failed atom callback surfaces: its own complete identity, or CALLBACK_FAILED. */
export function toAtomCallbackFailure(error: unknown): unknown {
  if (hasCompleteIdentity(error)) return error
  return createStoreKeyedError(
    StoreKeyedErrorCode.callbackFailed,
    StoreKeyedErrorText.callbackFailed,
    {
      cause: error
    }
  )
}

/** True when an error carries both `source` and `code` as own string data properties. */
export function hasCompleteIdentity(error: unknown): boolean {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return false
  return (
    typeof Object.getOwnPropertyDescriptor(error, 'source')?.value === 'string' &&
    typeof Object.getOwnPropertyDescriptor(error, 'code')?.value === 'string'
  )
}
