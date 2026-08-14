import {
  createWebStorageBackend,
  snapshotWebStorageOptions,
  type IWebStorageOptions
} from './web-storage';
import type { IKeyValueStore, ISyncCapableStore, IWebStorageLike } from '../types/storage';
import { StorageError, StorageErrorCode } from '../types/errors';

export type ISessionStorageOptions = IWebStorageOptions & {
  /** 注入点：测试环境与非浏览器环境用。默认为 globalThis.sessionStorage。 */
  readonly storage?: IWebStorageLike;
};

export const sessionStorage = (
  options: ISessionStorageOptions = {}
): ISyncCapableStore<IKeyValueStore> => {
  const optionsSnapshot = snapshotWebStorageOptions(options, 'session');
  let storage: IWebStorageLike | undefined;
  try {
    storage = options.storage;
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidArgument, { backend: 'session', cause });
  }
  return createWebStorageBackend(
    'session',
    storage ?? globalThis.sessionStorage,
    optionsSnapshot
  ) as ISyncCapableStore<IKeyValueStore>;
};
