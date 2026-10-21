import { memoryStorageHost } from '../backends/memory.js'
import { createBuiltInBackendPlugin } from './builtin-factory.js'
import { memoryBackendKind, type IBuiltInPluginId } from '../host/builtin-kinds.js'

/**
 * Define a memory backend plugin with default id memory. Store acquisition waits for Host install,
 * which owns rollback and final disposal; this ordinary plugin adds no reactive adapter. Backend
 * options retain their factory defaults.
 */
export const memoryBackendPlugin = <const TId extends string = 'memory'>(
  options: IBuiltInPluginId<TId> = {}
) =>
  createBuiltInBackendPlugin(memoryBackendKind, (options.id ?? 'memory') as TId, () =>
    memoryStorageHost()
  )
