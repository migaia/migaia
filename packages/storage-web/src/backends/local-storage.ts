import {
  createWebStorageBackend,
  snapshotWebStorageOptions,
  type IWebStorageOptions
} from './web-storage';
import type { IKeyValueStore, ISyncCapableStore, IWebStorageLike } from '../types/storage';
import { StorageError, StorageErrorCode } from '../types/errors';

export type ILocalStorageOptions = IWebStorageOptions & {
  /** 注入点：测试环境与非浏览器环境用。默认为 globalThis.localStorage。 */
  readonly storage?: IWebStorageLike;
};

export const localStorage = (
  options: ILocalStorageOptions = {}
): ISyncCapableStore<IKeyValueStore> => {
  const optionsSnapshot = snapshotWebStorageOptions(options, 'local');
  let storage: IWebStorageLike | undefined;
  try {
    storage = options.storage;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidArgument, { backend: 'local', cause });
  }
  return createWebStorageBackend(
    'local',
    storage ?? globalThis.localStorage,
    optionsSnapshot
  ) as ISyncCapableStore<IKeyValueStore>;
};
