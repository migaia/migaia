import { sessionStorageHost, type ISessionStorageOptions } from '../../backends/session-storage.js'
import { defineNativeReactiveFeature } from '../../host/contracts.js'
import { createBuiltInBackendPlugin } from '../builtin-factory.js'
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

/**
 * Define a sessionStorage backend plus its exact reactive adapter; default id session. Consistency
 * is hybrid/top-level-context-eventual, polling every 1000 ms. Host installation owns Store/source
 * rollback and disposal; eventual observation does not make cross-context writes transactional.
 */
export const sessionStorageReactive = {
  sessionStorageReactive: <const TId extends string = 'session'>(
    options: ISessionStorageOptions & IBuiltInPluginId<TId> = {}
  ): IStorageBackendPlugin<
    ISessionStorageBackendStore,
    typeof sessionStorageBackendKind,
    TId,
    true
  > =>
    createBuiltInBackendPlugin(
      sessionStorageBackendKind,
      (options.id ?? 'session') as TId,
      () => sessionStorageHost(options),
      { reactive: sessionStorageReactiveFeature }
    )
}.sessionStorageReactive
