import { cookiesHost, type ICookiesOptions } from '../backends/cookie.js'
import { defineBuiltInPlugin, type IStoragePluginCore } from '../host/contracts.js'
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
  defineBuiltInPlugin(
    cookieBackendKind,
    (options.id ?? 'cookies') as TId,
    (core: IStoragePluginCore<ICookieBackendStore>) => ({
      install: () => {
        core.registerStore(cookiesHost(options))
        return {}
      }
    })
  ) as IStorageBackendPlugin<ICookieBackendStore, typeof cookieBackendKind, TId>
