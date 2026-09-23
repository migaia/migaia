import { memoryStorageHost } from '../backends/memory.js'
import { createBuiltInBackendPlugin } from './builtin-factory.js'
import { memoryBackendKind, type IBuiltInPluginId } from '../host/builtin-kinds.js'

/** Creates a memory backend plugin using the canonical factory exactly once at install. */
export const memoryBackendPlugin = <const TId extends string = 'memory'>(
  options: IBuiltInPluginId<TId> = {}
) =>
  createBuiltInBackendPlugin(memoryBackendKind, (options.id ?? 'memory') as TId, () =>
    memoryStorageHost()
  )
