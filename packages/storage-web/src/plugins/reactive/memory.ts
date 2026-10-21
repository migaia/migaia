import { memoryStorageHost } from '../../backends/memory.js'
import { defineNativeReactiveFeature } from '../../host/contracts.js'
import { createBuiltInBackendPlugin } from '../builtin-factory.js'
import {
  memoryBackendKind,
  type IBuiltInPluginId,
  type IMemoryBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

/** One synchronous native Feature definition; it owns no Store, service, or scheduler. */
const memoryReactiveFeature = defineNativeReactiveFeature(
  { mode: 'push', visibility: 'instance' },
  memoryBackendKind
)

/**
 * Define a memory backend plus its exact reactive adapter; default id memory. Consistency is
 * push/instance, without polling. Host installation owns Store/source rollback and disposal;
 * eventual observation does not make cross-context writes transactional.
 */
export const memoryReactive = {
  memoryReactive: <const TId extends string = 'memory'>(
    options: IBuiltInPluginId<TId> = {}
  ): IStorageBackendPlugin<IMemoryBackendStore, typeof memoryBackendKind, TId, true> =>
    createBuiltInBackendPlugin(
      memoryBackendKind,
      (options.id ?? 'memory') as TId,
      () => memoryStorageHost(),
      { reactive: memoryReactiveFeature }
    )
}.memoryReactive
