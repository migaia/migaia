import { indexedDbHost, type IIndexedDbOptions } from '../../backends/indexed-db.js'
import { defineBuiltInReactivePlugin, defineNativeReactiveFeature } from '../../host/contracts.js'
import {
  indexedDbBackendKind,
  type IBuiltInPluginId,
  type IIndexedDbBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'
import { prepareIndexedDbStore } from '../indexed-db.js'

const indexedDbReactiveFeature = defineNativeReactiveFeature(
  {
    mode: 'hybrid',
    visibility: 'origin-eventual',
    pollIntervalMs: 1000
  },
  indexedDbBackendKind
)

/** Creates the canonical IndexedDB reactive fast-path plugin with private preparation. */
export function indexedDbReactive<const TId extends string = 'indexed-db'>(
  options: IIndexedDbOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<IIndexedDbBackendStore, typeof indexedDbBackendKind, TId, true> {
  return defineBuiltInReactivePlugin(
    indexedDbBackendKind,
    (options.id ?? 'indexed-db') as TId,
    (core) => ({
      install: async () => {
        const store = indexedDbHost(options)
        core.registerStore(store)
        await prepareIndexedDbStore(store)
        return {}
      }
    }),
    { reactive: indexedDbReactiveFeature }
  )
}

Object.defineProperty(indexedDbReactive, 'name', { value: 'indexedDbReactive' })
