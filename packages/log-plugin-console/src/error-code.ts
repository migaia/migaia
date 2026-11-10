/** Registered error domain for the console output plugin. */
export const ERROR_SOURCE = 'logging.console'

/** Console capabilities report delivery failures through the host; only option admission is coded. */
export const LogConsoleErrorCode = {
  /**
   * Reading a `consolePlugin` or `prettyFeature` option threw (a throwing getter or Proxy trap).
   * The original error is on `cause`; pass plain option values instead.
   */
  invalidOption: 'INVALID_OPTION'
} as const

/** Console error codes, interpreted with the `logging.console` domain. */
export type ILogConsoleErrorCode = (typeof LogConsoleErrorCode)[keyof typeof LogConsoleErrorCode]

/** Stable message for an option read failure; the original error is on `cause`. */
export const LogConsoleErrorText = {
  invalidOption: 'console output option could not be read'
} as const
