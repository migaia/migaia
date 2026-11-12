/** Atom callback failure classification; internal to store-keyed and not part of its public entry. */
import { hasErrorIdentity } from '@migaia/utils/error'
import { StoreKeyedErrorText } from '../error-text.ts'
import { StoreKeyedErrorCode } from '../error-code.ts'
import { createStoreKeyedError } from '../errors.ts'

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
  if (hasErrorIdentity(error)) return error
  return createStoreKeyedError(
    StoreKeyedErrorCode.callbackFailed,
    StoreKeyedErrorText.callbackFailed,
    {
      cause: error
    }
  )
}
