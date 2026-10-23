import { createLoggerError, LoggerErrorCode } from '../../errors.js'
import { DurableText } from './text.js'
import type { ILogStore, ILogStoreOptions } from './types.js'
/** Browser loading is safe; opening a local SQLite resource requires a supported server runtime. */
export function fileLogStore(_path: string, _options?: ILogStoreOptions): Promise<ILogStore> {
  return Promise.reject(
    createLoggerError(LoggerErrorCode.logStoreUnavailable, DurableText.unavailable)
  )
}
