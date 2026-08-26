import {
  createWebStorageBackend,
  snapshotWebStorageOptions,
  type IWebStorageOptions
} from './web-storage.js'
import type { IKeyValueStore, ISyncCapableStore, IWebStorageLike } from '../types/storage.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { StorageBackend } from '../constants.js'

export type ISessionStorageOptions = IWebStorageOptions & {
  /** 注入点：测试环境与非浏览器环境用。默认为 globalThis.sessionStorage。 */
  readonly storage?: IWebStorageLike
}

export const sessionStorage = (
  options: ISessionStorageOptions = {}
): ISyncCapableStore<IKeyValueStore> => {
  const optionsSnapshot = snapshotWebStorageOptions(options, StorageBackend.session)
  let storage: IWebStorageLike | undefined
  try {
    storage = options.storage
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.session,
      cause
    })
  }
  return createWebStorageBackend(
    StorageBackend.session,
    storage ?? globalThis.sessionStorage,
    optionsSnapshot
  ) as ISyncCapableStore<IKeyValueStore>
}
