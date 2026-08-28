import { sessionStorage, type ISessionStorageOptions } from '../backends/session-storage.js'
import { defineStorageBackendPlugin } from '../host/contracts.js'
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
  defineStorageBackendPlugin({
    backendKind: sessionStorageBackendKind,
    id: (options.id ?? 'session') as TId,
    create: () => sessionStorage(options)
  })
