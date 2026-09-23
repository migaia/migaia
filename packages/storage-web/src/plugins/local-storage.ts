import { localStorageHost, type ILocalStorageOptions } from '../backends/local-storage.js'
import { createBuiltInBackendPlugin } from './builtin-factory.js'
import {
  localStorageBackendKind,
  type IBuiltInPluginId,
  type ILocalStorageBackendStore
} from '../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../host/types.js'

/** Creates a local-storage plugin while preserving canonical factory options. */
export const localStorageBackendPlugin = <const TId extends string = 'local'>(
  options: ILocalStorageOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ILocalStorageBackendStore, typeof localStorageBackendKind, TId> =>
  createBuiltInBackendPlugin(localStorageBackendKind, (options.id ?? 'local') as TId, () =>
    localStorageHost(options)
  )
