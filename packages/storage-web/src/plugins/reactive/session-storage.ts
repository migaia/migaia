import { sessionStorage, type ISessionStorageOptions } from '../../backends/session-storage.js'
import { defineStorageBackendFeature, defineStorageBackendPlugin } from '../../host/contracts.js'
import {
  sessionStorageBackendKind,
  type IBuiltInPluginId,
  type ISessionStorageBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

const sessionStorageReactiveFeature = defineStorageBackendFeature(
  sessionStorageBackendKind,
  'reactive',
  {
    mode: 'hybrid',
    visibility: 'top-level-context-eventual',
    pollIntervalMs: 1000
  }
)

/** Creates the canonical sessionStorage reactive fast-path plugin. */
export function sessionStorageReactive<const TId extends string = 'session'>(
  options: ISessionStorageOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ISessionStorageBackendStore, typeof sessionStorageBackendKind, TId, true> {
  return defineStorageBackendPlugin({
    backendKind: sessionStorageBackendKind,
    id: (options.id ?? 'session') as TId,
    features: [sessionStorageReactiveFeature],
    create: () => sessionStorage(options)
  })
}

Object.defineProperty(sessionStorageReactive, 'name', { value: 'sessionStorageReactive' })
