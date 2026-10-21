import { sessionStorageHost, type ISessionStorageOptions } from '../backends/session-storage.js'
import { createBuiltInBackendPlugin } from './builtin-factory.js'
import {
  sessionStorageBackendKind,
  type IBuiltInPluginId,
  type ISessionStorageBackendStore
} from '../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../host/types.js'

/**
 * Define a sessionStorage backend plugin with default id session. Store acquisition waits for Host
 * install, which owns rollback and final disposal; this ordinary plugin adds no reactive adapter.
 * Backend options retain their factory defaults.
 */
export const sessionStorageBackendPlugin = <const TId extends string = 'session'>(
  options: ISessionStorageOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ISessionStorageBackendStore, typeof sessionStorageBackendKind, TId> =>
  createBuiltInBackendPlugin(sessionStorageBackendKind, (options.id ?? 'session') as TId, () =>
    sessionStorageHost(options)
  )
