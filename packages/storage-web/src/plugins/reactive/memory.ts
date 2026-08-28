import { memoryStorage } from '../../backends/memory.js'
import { defineStorageBackendFeature, defineStorageBackendPlugin } from '../../host/contracts.js'
import {
  memoryBackendKind,
  type IBuiltInPluginId,
  type IMemoryBackendStore
} from '../../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../../host/types.js'

const memoryReactiveFeature = defineStorageBackendFeature(memoryBackendKind, 'reactive', {
  mode: 'push',
  visibility: 'instance'
})

/** Creates the canonical memory reactive fast-path plugin with exact store identity. */
export function memoryReactive<const TId extends string = 'memory'>(
  options: IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<IMemoryBackendStore, typeof memoryBackendKind, TId, true> {
  return defineStorageBackendPlugin({
    backendKind: memoryBackendKind,
    id: (options.id ?? 'memory') as TId,
    features: [memoryReactiveFeature],
    create: () => memoryStorage()
  })
}

Object.defineProperty(memoryReactive, 'name', { value: 'memoryReactive' })
