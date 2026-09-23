import { sessionStorageHost, type ISessionStorageOptions } from '../backends/session-storage.js'
import { createBuiltInBackendPlugin } from './builtin-factory.js'
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
  createBuiltInBackendPlugin(sessionStorageBackendKind, (options.id ?? 'session') as TId, () =>
    sessionStorageHost(options)
  )
