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
    options !== undefined && 'cause' in options ? { cause: options.cause } : undefined
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
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  isNativeErrorValue,
  tryReadProperty
} from '@migaia/utils/error'
import { ReactiveErrorCode } from './error-code.js'
import { ReactiveErrorText } from './error-text.js'

/**
 * Gives unclassified native callback Errors the owning boundary's identity. Non-Error object throws
 * remain control values for the consuming owner, such as Resource's single-read Suspense admission;
 * this generic callback boundary must not probe or replace them.
 */
export function runReactiveCallback<T>(callback: () => T): T {
  try {
    return callback()
  } catch (error) {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
      if (!isNativeErrorValue(error)) throw error
      /** Valid semantic identities belong to their existing owner, including native reactive errors. */
      const source = tryReadProperty(error as { source?: unknown }, 'source')
      /** A host code alone is not a package identity. */
      const code = tryReadProperty(error as { code?: unknown }, 'code')
      if (
        !source.threw &&
        !code.threw &&
        typeof source.value === 'string' &&
        source.value.length > 0 &&
        typeof code.value === 'string' &&
        code.value.length > 0
      )
        throw error
      try {
        tagReactiveError(error, ReactiveErrorCode.callbackFailed)
      } catch (attachmentError) {
        throw attachSecondaryErrors(
          createReactiveError(ReactiveErrorCode.callbackFailed, ReactiveErrorText.callbackFailed, {
            cause: error
          }),
          [attachmentError]
        )
      }
      throw error
    }
    throw createReactiveError(ReactiveErrorCode.callbackFailed, ReactiveErrorText.callbackFailed, {
      cause: error
    })
  }
}
