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

/**
 * Define a cookie backend plus its exact reactive adapter; default id cookies. Consistency is
 * hybrid/origin-js-visible-eventual, polling every 1000 ms. Host installation owns Store/source
 * rollback and disposal; eventual observation does not make cross-context writes transactional.
 */
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
