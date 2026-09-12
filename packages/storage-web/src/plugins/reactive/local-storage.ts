import { localStorageHost, type ILocalStorageOptions } from '../../backends/local-storage.js'
import { defineBuiltInReactivePlugin, defineNativeReactiveFeature } from '../../host/contracts.js'
import {
  localStorageBackendKind,
  type IBuiltInPluginId,
  type ILocalStorageBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

const localStorageReactiveFeature = defineNativeReactiveFeature(
  {
    mode: 'hybrid',
    visibility: 'document-eventual',
    pollIntervalMs: 1000
  },
  localStorageBackendKind
)

/** Creates the canonical localStorageHost reactive fast-path plugin. */
export function localStorageReactive<const TId extends string = 'local'>(
  options: ILocalStorageOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ILocalStorageBackendStore, typeof localStorageBackendKind, TId, true> {
  return defineBuiltInReactivePlugin(
    localStorageBackendKind,
    (options.id ?? 'local') as TId,
    (core) => ({
      install: () => {
        core.registerStore(localStorageHost(options))
        return {}
      }
    }),
    { reactive: localStorageReactiveFeature }
  )
}

Object.defineProperty(localStorageReactive, 'name', { value: 'localStorageReactive' })
