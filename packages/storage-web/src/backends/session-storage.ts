import type { ITextRedoStore } from './text-redo.js'
import {
  createWebStorageBackend,
  snapshotWebStorageOptions,
  type IWebStorageOptions
} from './web-storage.js'
import type { IKeyValueStore, ISyncCapableStore, IWebStorageLike } from '../types/storage.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { StorageBackend } from '../constants.js'
import type {
  IBackendConstruction,
  IBackendRuntime,
  IKeyValueBackendStore
} from './construction.js'

/** Namespace and optional borrowed Storage port for a session-storage backend. */
export type ISessionStorageOptions = IWebStorageOptions & {
  /**
   * Injects storage for tests and non-browser environments. Defaults to
   * `globalThis.sessionStorage`.
   */
  readonly storage?: IWebStorageLike
}

/**
 * Creates a namespaced text store over the supplied port or the host's sessionStorage. The default
 * namespace is `default`, encoded by lengthPrefixedNamespaceCodec. Host access or probe failure
 * throws BACKEND_UNAVAILABLE with the original cause; invalid options remain INVALID_CONFIG.
 * Dispose releases this store's listeners without clearing the borrowed Storage data.
 */
export const sessionStorageHost = (
  options: ISessionStorageOptions,
  runtime: IBackendRuntime
): IBackendConstruction<
  IKeyValueBackendStore<ISyncCapableStore<IKeyValueStore> & ITextRedoStore>,
  IWebStorageLike
> => {
  /** Capture namespace configuration before admitting either an injected or ambient port. */
  const optionsSnapshot = snapshotWebStorageOptions(options, StorageBackend.session)
  /** Keep option-getter failure distinct from the host refusing access to its default port. */
  let storage: IWebStorageLike | undefined
  try {
    storage = options.storage
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend: StorageBackend.session,
      cause
    })
  }
  try {
    storage ??= globalThis.sessionStorage
  } catch (cause) {
    throw new StorageError(StorageErrorCode.unavailable, {
      backend: StorageBackend.session,
      cause
    })
  }
  return createWebStorageBackend(StorageBackend.session, storage, optionsSnapshot, runtime)
}
