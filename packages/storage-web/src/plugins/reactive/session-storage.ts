import { sessionStorageHost, type ISessionStorageOptions } from '../../backends/session-storage.js'
import { defineBuiltInReactivePlugin, defineNativeReactiveFeature } from '../../host/contracts.js'
import {
  sessionStorageBackendKind,
  type IBuiltInPluginId,
  type ISessionStorageBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

const sessionStorageReactiveFeature = defineNativeReactiveFeature(
  {
    mode: 'hybrid',
    visibility: 'top-level-context-eventual',
    pollIntervalMs: 1000
  },
  sessionStorageBackendKind
)

/** Creates the canonical sessionStorageHost reactive fast-path plugin. */
export function sessionStorageReactive<const TId extends string = 'session'>(
  options: ISessionStorageOptions & IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<ISessionStorageBackendStore, typeof sessionStorageBackendKind, TId, true> {
  return defineBuiltInReactivePlugin(
    sessionStorageBackendKind,
    (options.id ?? 'session') as TId,
    (core) => ({
      install: () => {
        core.registerStore(sessionStorageHost(options))
        return {}
      }
    }),
    { reactive: sessionStorageReactiveFeature }
  )
}

Object.defineProperty(sessionStorageReactive, 'name', { value: 'sessionStorageReactive' })
