import type { IStorageBase } from '@migaia/storage-contract'
import { StorageError, StorageErrorCode } from './errors.js'
import { StorageErrorText } from './error-text.js'
/** One registration owns one exact store identity, assigned only after admission. */
export type IStorageStoreCell = { set(store: IStorageBase): void; get(): IStorageBase }
/** Preserve the original install handoff without letting a Feature replace its store. */
export function createStorageStoreCell(): IStorageStoreCell {
  /** Only the admitted store is retained for this registration lifetime. */
  let value: IStorageBase | undefined
  return {
    set(store) {
      if (value !== undefined)
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      value = store
    },
    get() {
      if (value === undefined)
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      return value
    }
  }
}
