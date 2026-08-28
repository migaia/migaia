import { indexedDb, type IIndexedDbOptions } from '../backends/indexed-db.js'
import { asIndexedDbBackfillStore } from '../backends/indexed-db-backfill.js'
import { defineStorageBackendPlugin } from '../host/contracts.js'
import {
  indexedDbBackendKind,
  type IBuiltInPluginId,
  type IIndexedDbBackendStore
} from '../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../host/types.js'

/** Creates IndexedDB store synchronously, then lets Host register its disposer before preparation. */
export const indexedDbBackendPlugin = <const TId extends string = 'indexed-db'>(
  options: IIndexedDbOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<IIndexedDbBackendStore, typeof indexedDbBackendKind, TId> =>
  defineStorageBackendPlugin({
    backendKind: indexedDbBackendKind,
    id: (options.id ?? 'indexed-db') as TId,
    create: () => indexedDb(options),
    prepare: async (store) => {
      const privateStore = asIndexedDbBackfillStore(store)
      if (privateStore === undefined || privateStore.prepare === undefined)
        throw new TypeError('IndexedDB private preparation unavailable')
      await privateStore.prepare()
    }
  })
