import type { ILoggerRuntimeManager } from '../runtime-manager.js'
import { createFilePlugin, type IFilePluginConfig } from './file-core.js'

export { FILE_PLUGIN_NAME } from './file-core.js'
export type { IFilePluginConfig } from './file-core.js'

/** Node-compatible default append capability, loaded only when a write actually occurs. */
const defaultFileSink = (): NonNullable<ILoggerRuntimeManager['fs']> => ({
  append: async (path, text) => {
    const fs = await import('node:fs/promises')
    await fs.appendFile(path, text, 'utf8')
  }
})

/** Creates a file plugin that prefers injected fs and otherwise uses the Node default. */
export const file = (config: IFilePluginConfig) => createFilePlugin(config, defaultFileSink)
