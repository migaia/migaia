import { indexedDbHost, type IIndexedDbOptions } from '../backends/indexed-db.js'
import { asIndexedDbBackfillStore } from '../backends/indexed-db-backfill.js'
import { defineBuiltInPlugin, type IStoragePluginCore } from '../host/contracts.js'
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

/** Creates IndexedDB store synchronously, then lets Host register its disposer before preparation. */
export const indexedDbBackendPlugin = <const TId extends string = 'indexed-db'>(
  options: IIndexedDbOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<IIndexedDbBackendStore, typeof indexedDbBackendKind, TId> =>
  defineBuiltInPlugin(
    indexedDbBackendKind,
    (options.id ?? 'indexed-db') as TId,
    (core: IStoragePluginCore<IIndexedDbBackendStore>) => ({
      install: async () => {
        const store = indexedDbHost(options)
        core.registerStore(store)
        await prepareIndexedDbStore(store)
        return {}
      }
    })
  ) as IStorageBackendPlugin<IIndexedDbBackendStore, typeof indexedDbBackendKind, TId>
