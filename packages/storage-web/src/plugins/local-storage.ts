import { StorageBackend } from '../constants.js'
import { localStorageHost, type ILocalStorageOptions } from '../backends/local-storage.js'
import { createBuiltInBackendPlugin, readBuiltInPluginId } from './builtin-factory.js'
import { localStorageBackendKind, type IBuiltInPluginId } from '../host/builtin-kinds.js'
import type {
  IStorageBackendPlugin,
  IStorageFeatureRecord,
  IStorageFeatureStoreCompatibility
} from '@migaia/storage-host'

/**
 * Define a localStorage backend plugin with default id local. Store acquisition waits for Host
 * install, which owns rollback and final disposal; this ordinary plugin adds no reactive adapter.
 * Backend options retain their factory defaults.
 */
export const localStorageBackendPlugin = <
  const TId extends string = 'local',
  const F extends IStorageFeatureRecord = {}
>(
  options: ILocalStorageOptions & IBuiltInPluginId<TId> = {},
  features?: F & IStorageFeatureStoreCompatibility<typeof localStorageBackendKind, NoInfer<F>>
): IStorageBackendPlugin<typeof localStorageBackendKind, NoInfer<TId>, F> =>
  createBuiltInBackendPlugin<
    typeof localStorageBackendKind.name,
    ReturnType<typeof localStorageHost>['store'],
    ReturnType<ReturnType<typeof localStorageHost>['getClient']>,
    TId,
    F
  >(
    localStorageBackendKind,
    readBuiltInPluginId(options, 'local', StorageBackend.local),
    (core) => localStorageHost(options, core),
    features,
    true
  )
