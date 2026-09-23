import { createFilePlugin, type IFilePluginConfig } from './file-core.js'

export { FILE_PLUGIN_NAME } from './file-core.js'
export type { IFilePluginConfig } from './file-core.js'

/** Browser file delivery requires an explicitly injected fs capability. */
export const file = (config: IFilePluginConfig) => createFilePlugin(config)
