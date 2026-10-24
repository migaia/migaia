import type { ITextRedoStore } from './text-redo.js'
import {
  createWebStorageBackend,
  assertWebStorageOptions,
  type IWebStorageOptions
} from './web-storage.js'
import type { IKeyValueStore, ISyncCapableStore, IWebStorageLike } from '../types/storage.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { StorageBackend } from '../constants.js'
import type { ITextChangeFeedApi } from '@migaia/storage-contract'
import type {
  IBackendConstruction,
  IBackendRuntime,
  IKeyValueBackendStore
} from './construction.js'

/** Namespace and optional borrowed Storage port for a local-storage backend. */
export type ILocalStorageOptions = IWebStorageOptions & {
  /** Injects storage for tests and non-browser environments. Defaults to `globalThis.localStorage`. */
  readonly storage?: IWebStorageLike
}

/**
 * Creates a namespaced text store over the supplied port or the host's localStorage. The default
 * namespace is `default`, encoded by lengthPrefixedNamespaceCodec. Host access or probe failure
 * throws BACKEND_UNAVAILABLE with the original cause; invalid options remain INVALID_CONFIG.
 * Dispose releases this store's listeners without clearing the borrowed Storage data.
 */
export const localStorageHost = (
  options: ILocalStorageOptions,
  runtime: IBackendRuntime
): IBackendConstruction<
  IKeyValueBackendStore<ISyncCapableStore<IKeyValueStore> & ITextChangeFeedApi & ITextRedoStore>,
  IWebStorageLike
> => {
  /** Capture namespace configuration before admitting either an injected or ambient port. */
  assertWebStorageOptions(options)
  /** The native port stays borrowed; ambient access may be denied by browser policy. */
  let storage = options.storage
  try {
    storage ??= globalThis.localStorage
  } catch (cause) {
    throw new StorageError(StorageErrorCode.unavailable, {
      backend: StorageBackend.local,
      cause
    })
  }
  return createWebStorageBackend(StorageBackend.local, storage, options, runtime)
}
