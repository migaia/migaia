import { snapshotOptionProperties } from '@migaia/utils/object'
import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, LogConsoleErrorCode, LogConsoleErrorText } from './error-code.ts'
import { detectServerRuntime } from '@migaia/utils'
import type { IConsoleProcess } from './typing.ts'

/** Capture only a recognized server's process capability; browser-like hosts can omit it. */
export function consoleProcess(): IConsoleProcess | undefined {
  if (detectServerRuntime() === undefined) return undefined
  return (globalThis as unknown as { process?: IConsoleProcess }).process
}

/**
 * Copy caller options with one read of each own property. A throwing getter becomes the coded
 * `logging.console` INVALID_OPTION error with the original on `cause`.
 */
export function snapshotConsoleOptions<T extends object>(options: T): T {
  try {
    return Object.freeze(snapshotOptionProperties(options))
  } catch (error) {
    throw attachErrorIdentity(new TypeError(LogConsoleErrorText.invalidOption, { cause: error }), {
      source: ERROR_SOURCE,
      code: LogConsoleErrorCode.invalidOption
    })
  }
}
