import {
  createWebStorageBackend,
  snapshotWebStorageOptions,
  type IWebStorageOptions
} from './web-storage.js';
import type { IKeyValueStore, ISyncCapableStore, IWebStorageLike } from '../types/storage.js';
import { StorageError, StorageErrorCode } from '../types/errors.js';
import { StorageBackend } from '../constants.js';

export type ILocalStorageOptions = IWebStorageOptions & {
  /** 注入点：测试环境与非浏览器环境用。默认为 globalThis.localStorage。 */
  readonly storage?: IWebStorageLike;
};

export const localStorage = (
  options: ILocalStorageOptions = {}
): ISyncCapableStore<IKeyValueStore> => {
  const optionsSnapshot = snapshotWebStorageOptions(options, StorageBackend.local);
  let storage: IWebStorageLike | undefined;
  try {
    storage = options.storage;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.local,
      cause
    });
  }
  return createWebStorageBackend(
    StorageBackend.local,
    storage ?? globalThis.localStorage,
    optionsSnapshot
  ) as ISyncCapableStore<IKeyValueStore>;
};
