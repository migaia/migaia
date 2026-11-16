import { StorageBackend } from '../constants.ts'
import { sessionStorageHost, type ISessionStorageOptions } from '../backends/session-storage.ts'
import { createBuiltInBackendPlugin, readBuiltInPluginId } from './builtin-factory.ts'
import type { ISessionStorageBackend, IBuiltInPluginOptions } from '../host/builtin-backends.ts'
import type { IStorageBackendPlugin, IStorageFeatureRecord } from '@migaia/storage-host'
import { StorageReactiveVisibility } from '@migaia/storage-host/sdk'

/**
 * Define a sessionStorage backend plugin with default name session. Store acquisition waits for
 * Host install, which owns rollback and final disposal; this ordinary plugin adds no reactive
 * adapter. Backend options retain their factory defaults.
 */
export const sessionStorageBackendPlugin = <
  const TId extends string = 'session',
  const F extends IStorageFeatureRecord = {}
>(
  options: ISessionStorageOptions & IBuiltInPluginOptions<ISessionStorageBackend, TId, F> = {}
): IStorageBackendPlugin<ISessionStorageBackend, NoInfer<TId>, F> =>
  createBuiltInBackendPlugin<
    ReturnType<typeof sessionStorageHost>['store'],
    ReturnType<ReturnType<typeof sessionStorageHost>['getClient']>,
    TId,
    F
  >(
    StorageReactiveVisibility.topLevelContextEventual,
    readBuiltInPluginId(options, 'session', StorageBackend.session),
    (core) => sessionStorageHost(options, core),
    options.features,
    true
  )
