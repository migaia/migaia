import { indexedDbHost, type IIndexedDbOptions } from '../../backends/indexed-db.js'
import { defineNativeReactiveFeature } from '../../host/contracts.js'
import { createBuiltInBackendPlugin } from '../builtin-factory.js'
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
export const indexedDbReactive = {
  indexedDbReactive: <const TId extends string = 'indexed-db'>(
    options: IIndexedDbOptions & IBuiltInPluginId<TId> = {}
  ): IStorageBackendPlugin<IIndexedDbBackendStore, typeof indexedDbBackendKind, TId, true> =>
    createBuiltInBackendPlugin(
      indexedDbBackendKind,
      (options.id ?? 'indexed-db') as TId,
      () => indexedDbHost(options),
      { reactive: indexedDbReactiveFeature, prepare: prepareIndexedDbStore }
    )
}.indexedDbReactive
