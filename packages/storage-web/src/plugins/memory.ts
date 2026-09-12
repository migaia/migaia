import { memoryStorageHost } from '../backends/memory.js'
import { defineBuiltInPlugin, type IStoragePluginCore } from '../host/contracts.js'
import {
  memoryBackendKind,
  type IBuiltInPluginId,
  type IMemoryBackendStore
} from '../host/builtin-kinds.js'

/** Creates a memory backend plugin using the canonical factory exactly once at install. */
export const memoryBackendPlugin = <const TId extends string = 'memory'>(
  options: IBuiltInPluginId<TId> = {}
) =>
  defineBuiltInPlugin(
    memoryBackendKind,
    (options.id ?? 'memory') as TId,
    (core: IStoragePluginCore<IMemoryBackendStore>) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return {}
      }
    })
  )
