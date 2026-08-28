import { memoryStorage } from '../backends/memory.js'
import { defineStorageBackendPlugin } from '../host/contracts.js'
import {
  memoryBackendKind,
  type IBuiltInPluginId,
  type IMemoryBackendStore
} from '../host/builtin-kinds.js'
import type { IStorageBackendPlugin } from '../host/types.js'

/** Creates a memory backend plugin using the canonical factory exactly once at install. */
export const memoryBackendPlugin = <const TId extends string = 'memory'>(
  options: IBuiltInPluginId<TId> = {}
): IStorageBackendPlugin<IMemoryBackendStore, typeof memoryBackendKind, TId> =>
  defineStorageBackendPlugin({
    backendKind: memoryBackendKind,
    id: (options.id ?? 'memory') as TId,
    create: () => memoryStorage()
  })
