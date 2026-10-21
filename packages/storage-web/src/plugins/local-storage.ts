import { localStorageHost, type ILocalStorageOptions } from '../backends/local-storage.js'
import { createBuiltInBackendPlugin } from './builtin-factory.js'
import {
  localStorageBackendKind,
  type IBuiltInPluginId,
  type ILocalStorageBackendStore
} from '../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../host/types.js'

/**
 * Define a localStorage backend plugin with default id local. Store acquisition waits for Host
 * install, which owns rollback and final disposal; this ordinary plugin adds no reactive adapter.
 * Backend options retain their factory defaults.
 */
export const localStorageBackendPlugin = <const TId extends string = 'local'>(
  options: ILocalStorageOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ILocalStorageBackendStore, typeof localStorageBackendKind, TId> =>
  createBuiltInBackendPlugin(localStorageBackendKind, (options.id ?? 'local') as TId, () =>
    localStorageHost(options)
  )
