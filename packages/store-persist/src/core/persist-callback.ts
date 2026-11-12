/** Persist callback failure classification; internal to store-persist, not part of its public entry. */
import { hasErrorIdentity } from '@migaia/utils/error'
import { type IStorePersistErrorCode } from '../error-code.ts'
import { createStorePersistError } from '../errors.ts'

/**
 * Run a persist callback (partialize, merge). An error that already has its own complete
 * source/code identity passes through; anything else gets `code` with the original on `cause`.
 */
export function runPersistCallback<T>(
  code: IStorePersistErrorCode,
  message: string,
  callback: () => T
): T {
  try {
    return callback()
  } catch (error) {
    if (hasErrorIdentity(error)) throw error
    throw createStorePersistError(code, message, { cause: error })
  }
}
