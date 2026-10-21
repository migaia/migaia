import { createFilePlugin, type IFilePluginConfig } from './file-core.js'

export { FILE_PLUGIN_NAME } from './file-core.js'
export type { IFilePluginConfig } from './file-core.js'

/**
 * Create the browser/default file sink with required path and an explicitly injected runtime fs.
 * Missing fs fails installation with FILE_SINK_UNAVAILABLE. Queuing/rotation otherwise follows the
 * same shared/private batch policy as the Node entry; this module imports no filesystem fallback.
 */
export const file = (config: IFilePluginConfig) => createFilePlugin(config)
