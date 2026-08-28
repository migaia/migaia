import { cookies, type ICookiesOptions } from '../../backends/cookie.js'
import { defineStorageBackendFeature, defineStorageBackendPlugin } from '../../host/contracts.js'
import {
  cookieBackendKind,
  type IBuiltInPluginId,
  type ICookieBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

const cookiesReactiveFeature = defineStorageBackendFeature(cookieBackendKind, 'reactive', {
  mode: 'hybrid',
  visibility: 'origin-js-visible-eventual',
  pollIntervalMs: 1000
})

/** Creates the canonical cookies reactive fast-path plugin. */
export function cookiesReactive<const TId extends string = 'cookies'>(
  options: ICookiesOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ICookieBackendStore, typeof cookieBackendKind, TId, true> {
  return defineStorageBackendPlugin({
    backendKind: cookieBackendKind,
    id: (options.id ?? 'cookies') as TId,
    features: [cookiesReactiveFeature],
    create: () => cookies(options)
  })
}

Object.defineProperty(cookiesReactive, 'name', { value: 'cookiesReactive' })
