import { StorageBackend } from '../constants.js'
import { sessionStorageHost, type ISessionStorageOptions } from '../backends/session-storage.js'
import { createBuiltInBackendPlugin, readBuiltInPluginId } from './builtin-factory.js'
import { sessionStorageBackendKind, type IBuiltInPluginId } from '../host/builtin-kinds.js'
import type {
  IStorageBackendPlugin,
  IStorageFeatureRecord,
  IStorageFeatureStoreCompatibility
} from '@migaia/storage-host'

/**
 * Define a sessionStorage backend plugin with default id session. Store acquisition waits for Host
 * install, which owns rollback and final disposal; this ordinary plugin adds no reactive adapter.
 * Backend options retain their factory defaults.
 */
export const sessionStorageBackendPlugin = <
  const TId extends string = 'session',
  const F extends IStorageFeatureRecord = {}
>(
  options: ISessionStorageOptions & IBuiltInPluginId<TId> = {},
  features?: F & IStorageFeatureStoreCompatibility<typeof sessionStorageBackendKind, NoInfer<F>>
): IStorageBackendPlugin<typeof sessionStorageBackendKind, NoInfer<TId>, F> =>
  createBuiltInBackendPlugin<
    typeof sessionStorageBackendKind.name,
    ReturnType<typeof sessionStorageHost>['store'],
    ReturnType<ReturnType<typeof sessionStorageHost>['getClient']>,
    TId,
    F
  >(
    sessionStorageBackendKind,
    readBuiltInPluginId(options, 'session', StorageBackend.session),
    (core) => sessionStorageHost(options, core),
    features,
    true
  )
