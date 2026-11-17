import { StorageBackend } from '../constants.ts'
import { localStorageHost, type ILocalStorageOptions } from '../backends/local-storage.ts'
import { createBuiltInBackendPlugin, readBuiltInPluginId } from './builtin-factory.ts'
import type { ILocalStorageBackend, IBuiltInPluginOptions } from '../host/builtin-backends.ts'
import type { IStorageBackendPlugin, IStorageFeatureRecord } from '@migaia/storage-host'
import { StorageReactiveVisibility } from '@migaia/storage-host/sdk'

/**
 * Define a localStorage backend plugin with default name local. Store acquisition waits for Host
 * install, which owns rollback and final disposal; this ordinary plugin adds no reactive adapter.
 * Backend options retain their factory defaults.
 */
export const localStorageBackendPlugin = <
  const TId extends string = 'local',
  const F extends IStorageFeatureRecord = {}
>(
  options: ILocalStorageOptions & IBuiltInPluginOptions<ILocalStorageBackend, TId, F> = {}
): IStorageBackendPlugin<ILocalStorageBackend, NoInfer<TId>, F> =>
  createBuiltInBackendPlugin<
    ReturnType<typeof localStorageHost>['store'],
    ReturnType<ReturnType<typeof localStorageHost>['getClient']>,
    TId,
    F
  >(
    StorageReactiveVisibility.documentEventual,
    readBuiltInPluginId(options, 'local', StorageBackend.local),
    (core) => localStorageHost(options, core),
    options.features,
    true
  )
