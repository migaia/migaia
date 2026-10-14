/** `source` value stamped onto every error this package throws. */
export const REACTIVE_SOURCE = '@migaia/reactive'

/**
 * Shared error contract from `docs/contracts/error-codes.md` §2. `source` and `code` are attached
 * as properties without replacing the error. Checks such as `instanceof RangeError` and `instanceof
 * AggregateError` keep their meaning.
 */
export type IReactiveError = Error & {
  readonly source: string
  readonly code: string
}

/** Creates an `Error` with `(source, code)` and preserves the stack captured by its constructor. */
export function createReactiveError(
  code: string,
  message: string,
  options?: { readonly cause?: unknown }
): IReactiveError {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return attachErrorIdentity(error, { source: REACTIVE_SOURCE, code }) as IReactiveError
}

/**
 * Attaches `(source, code)` to an existing error without changing `message`, `stack`, or other
 * fields. Use this for errors such as `RangeError`, `TypeError`, or `AggregateError` when callers
 * rely on their native type instead of the plain `Error` created by `createReactiveError`.
 */
export function tagReactiveError<E extends Error>(error: E, code: string): E {
  return attachErrorIdentity(error, { source: REACTIVE_SOURCE, code })
}
import { attachErrorIdentity } from '@migaia/utils/error'
