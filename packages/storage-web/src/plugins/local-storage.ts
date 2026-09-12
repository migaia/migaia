import { localStorageHost, type ILocalStorageOptions } from '../backends/local-storage.js'
import { defineBuiltInPlugin, type IStoragePluginCore } from '../host/contracts.js'
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
  defineBuiltInPlugin(
    localStorageBackendKind,
    (options.id ?? 'local') as TId,
    (core: IStoragePluginCore<ILocalStorageBackendStore>) => ({
      install: () => {
        core.registerStore(localStorageHost(options))
        return {}
      }
    })
  ) as IStorageBackendPlugin<ILocalStorageBackendStore, typeof localStorageBackendKind, TId>
