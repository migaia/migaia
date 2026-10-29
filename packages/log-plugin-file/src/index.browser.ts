import type { ILogFeatureRecord } from '@migaia/log-host/plugin'
import { createFilePlugin } from './file-core.ts'
import type { IFilePluginConfig } from './typing.ts'

/** Create a portable file output only with an explicit writer; no native filesystem is imported. */
export function filePlugin<const F extends ILogFeatureRecord = Record<never, never>>(
  options: IFilePluginConfig<F>
) {
  return createFilePlugin(options)
}

export type { IFilePluginConfig } from './typing.ts'
export { LogFileErrorCode, ERROR_SOURCE as LOG_FILE_ERROR_SOURCE } from './error-code.ts'
