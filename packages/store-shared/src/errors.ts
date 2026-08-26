import { StoreSharedErrorCode, type IStoreSharedErrorCode } from './error-code.js'
import { attachErrorIdentity } from '@migaia/utils/error'

export { StoreSharedErrorCode, type IStoreSharedErrorCode }

/** `source` value stamped onto every error this package throws. */
export const STORE_SHARED_SOURCE = '@migaia/store-shared'

function tagStoreSharedError<E extends Error>(error: E, code: IStoreSharedErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_SHARED_SOURCE, code })
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreSharedError(
  code: IStoreSharedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreSharedError(error, code)
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreSharedRangeError(
  code: IStoreSharedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): RangeError {
  const error = new RangeError(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreSharedError(error, code)
}
