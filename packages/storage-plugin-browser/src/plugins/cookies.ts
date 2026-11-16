import { StorageBackend } from '../constants.ts'
import { cookiesHost, type ICookiesOptions } from '../backends/cookie.ts'
import { createBuiltInBackendPlugin, readBuiltInPluginId } from './builtin-factory.ts'
import type { ICookieBackend, IBuiltInPluginOptions } from '../host/builtin-backends.ts'
import type { IStorageBackendPlugin, IStorageFeatureRecord } from '@migaia/storage-host'
import { StorageReactiveVisibility } from '@migaia/storage-host/sdk'

/**
 * Define a cookie backend plugin with default name cookies. Store acquisition waits for Host
 * install, which owns rollback and final disposal; this ordinary plugin adds no reactive adapter.
 * Backend options retain their factory defaults.
 */
export const cookieBackendPlugin = <
  const TId extends string = 'cookies',
  const F extends IStorageFeatureRecord = {}
>(
  options: ICookiesOptions & IBuiltInPluginOptions<ICookieBackend, TId, F> = {}
): IStorageBackendPlugin<ICookieBackend, NoInfer<TId>, F> =>
  createBuiltInBackendPlugin<
    ReturnType<typeof cookiesHost>['store'],
    ReturnType<ReturnType<typeof cookiesHost>['getClient']>,
    TId,
    F
  >(
    StorageReactiveVisibility.originJsVisibleEventual,
    readBuiltInPluginId(options, 'cookies', StorageBackend.cookie),
    (core) => cookiesHost(options, core),
    options.features,
    true
  )
