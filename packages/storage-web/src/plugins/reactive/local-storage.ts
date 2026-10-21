import { localStorageHost, type ILocalStorageOptions } from '../../backends/local-storage.js'
import { defineNativeReactiveFeature } from '../../host/contracts.js'
import { createBuiltInBackendPlugin } from '../builtin-factory.js'
import {
  localStorageBackendKind,
  type IBuiltInPluginId,
  type ILocalStorageBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

const localStorageReactiveFeature = defineNativeReactiveFeature(
  {
    mode: 'hybrid',
    visibility: 'document-eventual',
    pollIntervalMs: 1000
  },
  localStorageBackendKind
)

/**
 * Define a localStorage backend plus its exact reactive adapter; default id local. Consistency is
 * hybrid/document-eventual, polling every 1000 ms. Host installation owns Store/source rollback and
 * disposal; eventual observation does not make cross-context writes transactional.
 */
export const localStorageReactive = {
  localStorageReactive: <const TId extends string = 'local'>(
    options: ILocalStorageOptions & IBuiltInPluginId<TId> = {}
  ): IStorageBackendPlugin<ILocalStorageBackendStore, typeof localStorageBackendKind, TId, true> =>
    createBuiltInBackendPlugin(
      localStorageBackendKind,
      (options.id ?? 'local') as TId,
      () => localStorageHost(options),
      { reactive: localStorageReactiveFeature }
    )
}.localStorageReactive
