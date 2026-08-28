import { localStorage, type ILocalStorageOptions } from '../../backends/local-storage.js'
import { defineStorageBackendFeature, defineStorageBackendPlugin } from '../../host/contracts.js'
import {
  localStorageBackendKind,
  type IBuiltInPluginId,
  type ILocalStorageBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

const localStorageReactiveFeature = defineStorageBackendFeature(
  localStorageBackendKind,
  'reactive',
  {
    mode: 'hybrid',
    visibility: 'document-eventual',
    pollIntervalMs: 1000
  }
)

/** Creates the canonical localStorage reactive fast-path plugin. */
export function localStorageReactive<const TId extends string = 'local'>(
  options: ILocalStorageOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ILocalStorageBackendStore, typeof localStorageBackendKind, TId, true> {
  return defineStorageBackendPlugin({
    backendKind: localStorageBackendKind,
    id: (options.id ?? 'local') as TId,
    features: [localStorageReactiveFeature],
    create: () => localStorage(options)
  })
}

Object.defineProperty(localStorageReactive, 'name', { value: 'localStorageReactive' })
