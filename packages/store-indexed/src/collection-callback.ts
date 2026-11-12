import { identifyBoundaryFailure } from '@migaia/utils/error'
import { createStoreIndexedError, STORE_INDEXED_SOURCE } from './errors.ts'
import { StoreIndexedErrorCode } from './error-code.ts'
import { StoreIndexedErrorText } from './error-text.ts'

/**
 * Runs a supported synchronous extension at its collection boundary without changing its return
 * value.
 */
export function runCollectionCallback<T>(callback: () => T): T {
  try {
    return callback()
  } catch (error) {
    throw identifyBoundaryFailure(
      error,
      { source: STORE_INDEXED_SOURCE, code: StoreIndexedErrorCode.callbackFailed },
      (cause) =>
        createStoreIndexedError(
          StoreIndexedErrorCode.callbackFailed,
          StoreIndexedErrorText.callbackFailed,
          { cause }
        )
    )
  }
}
