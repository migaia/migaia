import type { ILogFeatureRecord } from '@migaia/log-host/plugin'
import { createFilePlugin } from './file-core.ts'
import { nativeFileWriter } from './native-writer.ts'
import type { IFilePluginConfig } from './typing.ts'

/** Create a server file output with an injected writer or the recognized runtime's native append. */
export function filePlugin<const F extends ILogFeatureRecord = Record<never, never>>(
  options: IFilePluginConfig<F>
) {
  return createFilePlugin(options, options.writer ? undefined : nativeFileWriter())
}

export type { IFilePluginConfig } from './typing.ts'
export { LogFileErrorCode, ERROR_SOURCE as LOG_FILE_ERROR_SOURCE } from './error-code.ts'
