import { createDurableError, LogDurableErrorCode } from './errors.ts'
import { DurableText } from './error-text.ts'
import type { ILogStore, ILogStoreOptions } from './types.ts'
/** Browser loading is safe; opening a local SQLite resource requires a supported server runtime. */
export function fileLogStore(_path: string, _options?: ILogStoreOptions): Promise<ILogStore> {
  return Promise.reject(
    createDurableError(LogDurableErrorCode.logStoreUnavailable, DurableText.unavailable)
  )
}
