import type { IStorageBase } from '@migaia/storage-contract'
import { StorageError, StorageErrorCode } from './errors.js'
import { StorageErrorText } from './error-text.js'
/** One registration binds one construction identity and publishes it only after admission. */
export type IStorageStoreCell = {
  bind(store: IStorageBase): void
  set(store: IStorageBase): void
  get(): IStorageBase
}
/** Preserve the original install handoff without letting a Feature replace its store. */
export function createStorageStoreCell(): IStorageStoreCell {
  /** The same store pointer survives construction binding and the final admitted handoff. */
  let value: IStorageBase | undefined
  /** Construction binding must agree with the one eventual admitted store. */
  let admitted = false
  return {
    bind(store) {
      if (value !== undefined && value !== store)
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      value = store
    },
    set(store) {
      if (admitted || (value !== undefined && value !== store))
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      value = store
      admitted = true
    },
    get() {
      if (!admitted || value === undefined)
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      return value
    }
  }
}
