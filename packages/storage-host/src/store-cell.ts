import type { IChainMethods, IStorageBase } from '@migaia/storage-contract'
import { StorageError, StorageErrorCode } from './errors.js'
import { StorageErrorText } from './error-text.js'
import type { IStorageFeatureProjection } from './feature-install.js'
/** One registration binds one construction identity and publishes it only after admission. */
export type IStorageStoreCell = {
  bind(store: IStorageBase): void
  set(store: IStorageBase): void
  get(): IStorageBase
  setFeatureProjection(projection: IStorageFeatureProjection | undefined): void
  createTransactionApi(scope: object): object | undefined
  getChainMethods(family: keyof IChainMethods): object | undefined
}
/** Preserve the original install handoff without letting a Feature replace its store. */
export function createStorageStoreCell(): IStorageStoreCell {
  /** The same store pointer survives construction binding and the final admitted handoff. */
  let value: IStorageBase | undefined
  /** Construction binding must agree with the one eventual admitted store. */
  let admitted = false
  /** Selected Feature output is owned by this same original registration, without a scope table. */
  let projection: IStorageFeatureProjection | undefined
  return {
    setFeatureProjection: (value) => {
      projection = value
    },
    createTransactionApi: (scope) => projection?.createTransactionApi?.(scope),
    getChainMethods: (family) => projection?.chain?.[family],
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
