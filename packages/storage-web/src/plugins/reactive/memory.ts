import { memoryStorageHost } from '../../backends/memory.js'
import { defineBuiltInReactivePlugin, defineNativeReactiveFeature } from '../../host/contracts.js'
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

/** Creates the canonical memory reactive fast-path plugin with exact store identity. */
export function memoryReactive<const TId extends string = 'memory'>(
  options: IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<IMemoryBackendStore, typeof memoryBackendKind, TId, true> {
  const id = (options.id ?? 'memory') as TId
  return defineBuiltInReactivePlugin(
    memoryBackendKind,
    id,
    (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return {}
      }
    }),
    { reactive: memoryReactiveFeature }
  )
}

Object.defineProperty(memoryReactive, 'name', { value: 'memoryReactive' })
