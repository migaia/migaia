import { indexedDb, type IIndexedDbOptions } from '../../backends/indexed-db.js'
import { asIndexedDbBackfillStore } from '../../backends/indexed-db-backfill.js'
import { defineStorageBackendFeature, defineStorageBackendPlugin } from '../../host/contracts.js'
import {
  indexedDbBackendKind,
  type IBuiltInPluginId,
  type IIndexedDbBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

const indexedDbReactiveFeature = defineStorageBackendFeature(indexedDbBackendKind, 'reactive', {
  mode: 'hybrid',
  visibility: 'origin-eventual',
  pollIntervalMs: 1000
})

/** Creates the canonical IndexedDB reactive fast-path plugin with private preparation. */
export function indexedDbReactive<const TId extends string = 'indexed-db'>(
  options: IIndexedDbOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<IIndexedDbBackendStore, typeof indexedDbBackendKind, TId, true> {
  return defineStorageBackendPlugin({
    backendKind: indexedDbBackendKind,
    id: (options.id ?? 'indexed-db') as TId,
    features: [indexedDbReactiveFeature],
    create: () => indexedDb(options),
    prepare: async (store) => {
      const privateStore = asIndexedDbBackfillStore(store)
      if (privateStore === undefined || privateStore.prepare === undefined)
        throw new TypeError('IndexedDB private preparation unavailable')
      await privateStore.prepare()
    }
  })
}

Object.defineProperty(indexedDbReactive, 'name', { value: 'indexedDbReactive' })
