import { indexedDbHost, type IIndexedDbOptions } from '../backends/indexed-db.js'
import { asIndexedDbBackfillStore } from '../backends/indexed-db-backfill.js'
import { createBuiltInBackendPlugin } from './builtin-factory.js'
import {
  indexedDbBackendKind,
  type IBuiltInPluginId,
  type IIndexedDbBackendStore
} from '../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../host/types.js'
import type { IKeyValueStore } from '@migaia/storage-contract'
import { createStorageTypeError, StorageErrorCode } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'

/** Prepares an owned IndexedDB Store only after its Host disposer has been registered. */
export const prepareIndexedDbStore = async (store: IKeyValueStore): Promise<void> => {
  const privateStore = asIndexedDbBackfillStore(store)
  if (privateStore === undefined || privateStore.prepare === undefined)
    throw createStorageTypeError(
      StorageErrorCode.backendPluginInvalid,
      StorageErrorText.backendPluginInvalid
    )
  await privateStore.prepare()
}

/**
 * Define a IndexedDB backend plugin with default id indexed-db. Store acquisition waits for Host
 * install, which owns rollback and final disposal; this ordinary plugin adds no reactive adapter.
 * Backend options retain their factory defaults.
 */
export const indexedDbBackendPlugin = <const TId extends string = 'indexed-db'>(
  options: IIndexedDbOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<IIndexedDbBackendStore, typeof indexedDbBackendKind, TId> =>
  createBuiltInBackendPlugin(
    indexedDbBackendKind,
    (options.id ?? 'indexed-db') as TId,
    () => indexedDbHost(options),
    { prepare: prepareIndexedDbStore }
  )
