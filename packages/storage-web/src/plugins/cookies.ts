import { cookiesHost, type ICookiesOptions } from '../backends/cookie.js'
import { createBuiltInBackendPlugin } from './builtin-factory.js'
import {
  cookieBackendKind,
  type IBuiltInPluginId,
  type ICookieBackendStore
} from '../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../host/types.js'

/**
 * Define a cookie backend plugin with default id cookies. Store acquisition waits for Host install,
 * which owns rollback and final disposal; this ordinary plugin adds no reactive adapter. Backend
 * options retain their factory defaults.
 */
export const cookieBackendPlugin = <const TId extends string = 'cookies'>(
  options: ICookiesOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ICookieBackendStore, typeof cookieBackendKind, TId> =>
  createBuiltInBackendPlugin(cookieBackendKind, (options.id ?? 'cookies') as TId, () =>
    cookiesHost(options)
  )
