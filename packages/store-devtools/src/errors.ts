import { StoreDevtoolsErrorCode, type IStoreDevtoolsErrorCode } from './error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'

export { StoreDevtoolsErrorCode, type IStoreDevtoolsErrorCode }

/** `source` value stamped onto every error this package throws. */
export const STORE_DEVTOOLS_SOURCE = '@migaia/store-devtools'

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreDevtoolsError<E extends Error>(error: E, code: IStoreDevtoolsErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_DEVTOOLS_SOURCE, code })
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreDevtoolsError(
  code: IStoreDevtoolsErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreDevtoolsError(error, code)
}

/** Builds a tagged AggregateError while retaining every subscription failure. */
export function createStoreDevtoolsAggregateError(
  code: IStoreDevtoolsErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreDevtoolsError(new AggregateError(errors, message), code)
}

/**
 * Builds a `(source, code)`-tagged `RangeError`. The error type matters to callers that branch on
 * `instanceof RangeError`, so this preserves it instead of producing a plain `Error`.
 */
export function createStoreDevtoolsRangeError(
  code: IStoreDevtoolsErrorCode,
  message: string
): RangeError {
  return tagStoreDevtoolsError(new RangeError(message), code)
}
