import { cookiesHost, type ICookiesOptions } from '../../backends/cookie.js'
import { defineBuiltInReactivePlugin, defineNativeReactiveFeature } from '../../host/contracts.js'
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
export function cookiesReactive<const TId extends string = 'cookies'>(
  options: ICookiesOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ICookieBackendStore, typeof cookieBackendKind, TId, true> {
  return defineBuiltInReactivePlugin(
    cookieBackendKind,
    (options.id ?? 'cookies') as TId,
    (core) => ({
      install: () => {
        core.registerStore(cookiesHost(options))
        return {}
      }
    }),
    { reactive: cookiesReactiveFeature }
  )
}

Object.defineProperty(cookiesReactive, 'name', { value: 'cookiesReactive' })
