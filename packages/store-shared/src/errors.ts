import { ERROR_SOURCE, StoreSharedErrorCode, type IStoreSharedErrorCode } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'

export { StoreSharedErrorCode, type IStoreSharedErrorCode }

/** Identity for package-owned errors; complete foreign callback identities keep their own source. */
export const STORE_SHARED_SOURCE = ERROR_SOURCE

function tagStoreSharedError<E extends Error>(error: E, code: IStoreSharedErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_SHARED_SOURCE, code })
}

/**
 * Creates a package-owned Error for a failure described by an existing public code and message. A
 * supplied non-undefined cause is retained by identity; omission adds no cause property. The newly
 * created native error receives STORE_SHARED_SOURCE/code without replacing its stack. Use this for
 * package-level composition, rather than relabeling an already classified error.
 */
export function createStoreSharedError(
  code: IStoreSharedErrorCode,
  message: string,
  options?: {
    /** Original failure to retain; omission or undefined leaves the new error without a cause. */
    readonly cause?: unknown
  }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreSharedError(error, code)
}

/**
 * Creates a package-owned RangeError when a value or layout violates an existing public code. It
 * retains a supplied non-undefined cause and the native RangeError class/stack while attaching
 * STORE_SHARED_SOURCE/code. Use createStoreSharedError() for failures without range semantics.
 */
export function createStoreSharedRangeError(
  code: IStoreSharedErrorCode,
  message: string,
  options?: {
    /** Original failure to retain; omission or undefined leaves the new error without a cause. */
    readonly cause?: unknown
  }
): RangeError {
  const error = new RangeError(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreSharedError(error, code)
}
