import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, LogDurableErrorCode, type ILogDurableErrorCode } from './error-code.ts'

export { ERROR_SOURCE, LogDurableErrorCode }

/** Fresh native errors are attachable; their runtime type and original stack stay intact. */
export function tagDurableError<E extends Error>(error: E, code: ILogDurableErrorCode): E {
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
}

/** Construct a durable failure while retaining the exact original cause object. */
export function createDurableError(
  code: ILogDurableErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  return tagDurableError(
    new Error(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code
  )
}

/** Argument failures keep their native TypeError identity for callers branching on it. */
export function createDurableTypeError(
  code: ILogDurableErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError {
  return tagDurableError(
    new TypeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code
  )
}

/** Error identity inspection uses the canonical property names attached by utils. */
export const DurableErrorField = {
  /** Package/domain provenance is read without invoking user getters. */
  source: 'source',
  /** A native transaction's semantic code is preserved when both identity fields exist. */
  code: 'code'
} as const
