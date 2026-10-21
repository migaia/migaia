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

/**
 * Create a newline-delimited JSON sink using injected fs or a lazily loaded Node-compatible append
 * fallback. Required path and positive integer rotation thresholds are validated before install.
 * Queuing uses the shared batch provider or a private fallback; write failures retain their cause
 * under DELIVERY_FAILED. The default append fallback supplies no rotate operation.
 */
export const file = (config: IFilePluginConfig) => createFilePlugin(config, defaultFileSink)
