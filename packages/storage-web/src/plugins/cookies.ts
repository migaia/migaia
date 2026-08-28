import { cookies, type ICookiesOptions } from '../backends/cookie.js'
import { defineStorageBackendPlugin } from '../host/contracts.js'
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
  defineStorageBackendPlugin({
    backendKind: cookieBackendKind,
    id: (options.id ?? 'cookies') as TId,
    create: () => cookies(options)
  })
