import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'
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
    if (isNativeErrorValue(error)) {
      /** Descriptors allow classification without invoking application metadata getters. */
      let identified: Error | undefined
      try {
        /** Complete existing identities continue to name their actual package owner. */
        const source = Object.getOwnPropertyDescriptor(error, 'source')
        /** Missing identity is attached only to an extensible native Error. */
        const code = Object.getOwnPropertyDescriptor(error, 'code')
        if (typeof source?.value === 'string' && typeof code?.value === 'string') identified = error
        else if (!source && !code && Object.isExtensible(error))
          identified = attachErrorIdentity(error, {
            source: STORE_INDEXED_SOURCE,
            code: StoreIndexedErrorCode.callbackFailed
          })
      } catch (metadataError) {
        throw attachErrorIdentity(
          new AggregateError([error, metadataError], StoreIndexedErrorText.callbackFailed),
          { source: STORE_INDEXED_SOURCE, code: StoreIndexedErrorCode.callbackFailed }
        )
      }
      if (identified) throw identified
    }
    throw createStoreIndexedError(
      StoreIndexedErrorCode.callbackFailed,
      StoreIndexedErrorText.callbackFailed,
      { cause: error }
    )
  }
}
