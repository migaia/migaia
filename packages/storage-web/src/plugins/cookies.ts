import { cookiesHost, type ICookiesOptions } from '../backends/cookie.js'
import { createBuiltInBackendPlugin } from './builtin-factory.js'
import {
  cookieBackendKind,
  type IBuiltInPluginId,
  type ICookieBackendStore
} from '../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../host/types.js'

/** Creates a cookie plugin while preserving canonical factory options. */
export const cookieBackendPlugin = <const TId extends string = 'cookies'>(
  options: ICookiesOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ICookieBackendStore, typeof cookieBackendKind, TId> =>
  createBuiltInBackendPlugin(cookieBackendKind, (options.id ?? 'cookies') as TId, () =>
    cookiesHost(options)
  )
