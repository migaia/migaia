import { cookiesHost, type ICookiesOptions } from '../../backends/cookie.js'
import { defineNativeReactiveFeature } from '../../host/contracts.js'
import { createBuiltInBackendPlugin } from '../builtin-factory.js'
import {
  cookieBackendKind,
  type IBuiltInPluginId,
  type ICookieBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

const cookiesReactiveFeature = defineNativeReactiveFeature(
  {
    mode: 'hybrid',
    visibility: 'origin-js-visible-eventual',
    pollIntervalMs: 1000
  },
  cookieBackendKind
)

/** Creates the canonical cookiesHost reactive fast-path plugin. */
export const cookiesReactive = {
  cookiesReactive: <const TId extends string = 'cookies'>(
    options: ICookiesOptions & IBuiltInPluginId<TId> = {}
  ): IStorageBackendPlugin<ICookieBackendStore, typeof cookieBackendKind, TId, true> =>
    createBuiltInBackendPlugin(
      cookieBackendKind,
      (options.id ?? 'cookies') as TId,
      () => cookiesHost(options),
      { reactive: cookiesReactiveFeature }
    )
}.cookiesReactive
