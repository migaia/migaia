import type { ILogFeatureRecord } from '@migaia/log-host/plugin'
import { createFilePlugin, snapshotFileOptions } from './file-core.ts'
import { nativeFileWriter } from './native-writer.ts'
import type { IFilePluginConfig } from './typing.ts'

/** Create a server file output with an injected writer or the recognized runtime's native append. */
export function filePlugin<const F extends ILogFeatureRecord = Record<never, never>>(
  requested: IFilePluginConfig<F>
): ReturnType<typeof createFilePlugin<F>> {
  /** One read of the options, so the writer choice and the output see the same writer. */
  const options = snapshotFileOptions(requested)
  return createFilePlugin(options, options.writer ? undefined : nativeFileWriter())
}

export type { IFilePluginConfig } from './typing.ts'
export { LogFileErrorCode, ERROR_SOURCE as LOG_FILE_ERROR_SOURCE } from './error-code.ts'
