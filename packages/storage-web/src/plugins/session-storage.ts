import { sessionStorageHost, type ISessionStorageOptions } from '../backends/session-storage.js'
import { defineBuiltInPlugin, type IStoragePluginCore } from '../host/contracts.js'
import {
  sessionStorageBackendKind,
  type IBuiltInPluginId,
  type ISessionStorageBackendStore
} from '../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../host/types.js'

/** Creates a session-storage plugin while preserving canonical factory options. */
export const sessionStorageBackendPlugin = <const TId extends string = 'session'>(
  options: ISessionStorageOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ISessionStorageBackendStore, typeof sessionStorageBackendKind, TId> =>
  defineBuiltInPlugin(
    sessionStorageBackendKind,
    (options.id ?? 'session') as TId,
    (core: IStoragePluginCore<ISessionStorageBackendStore>) => ({
      install: () => {
        core.registerStore(sessionStorageHost(options))
        return {}
      }
    })
  ) as IStorageBackendPlugin<ISessionStorageBackendStore, typeof sessionStorageBackendKind, TId>
