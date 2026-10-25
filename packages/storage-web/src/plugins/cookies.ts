import { StorageBackend } from '../constants.js'
import { cookiesHost, type ICookiesOptions } from '../backends/cookie.js'
import { createBuiltInBackendPlugin, readBuiltInPluginId } from './builtin-factory.js'
import { cookieBackendKind, type IBuiltInPluginId } from '../host/builtin-kinds.js'
import type {
  IStorageBackendPlugin,
  IStorageFeatureRecord,
  IStorageFeatureStoreCompatibility
} from '@migaia/storage-host'

/**
 * Define a cookie backend plugin with default id cookies. Store acquisition waits for Host install,
 * which owns rollback and final disposal; this ordinary plugin adds no reactive adapter. Backend
 * options retain their factory defaults.
 */
export const cookieBackendPlugin = <
  const TId extends string = 'cookies',
  const F extends IStorageFeatureRecord = {}
>(
  options: ICookiesOptions & IBuiltInPluginId<TId> = {},
  features?: F & IStorageFeatureStoreCompatibility<typeof cookieBackendKind, NoInfer<F>>
): IStorageBackendPlugin<typeof cookieBackendKind, NoInfer<TId>, F> =>
  createBuiltInBackendPlugin<
    typeof cookieBackendKind.name,
    ReturnType<typeof cookiesHost>['store'],
    ReturnType<ReturnType<typeof cookiesHost>['getClient']>,
    TId,
    F
  >(
    cookieBackendKind,
    readBuiltInPluginId(options, 'cookies', StorageBackend.cookie),
    (core) => cookiesHost(options, core),
    features,
    true
  )
