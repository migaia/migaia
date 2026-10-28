/** Console capabilities report their original failures through the host and declare no local codes. */
export const LogConsoleErrorCode = {} as const

/** An empty code table intentionally has no error domain or values. */
export type ILogConsoleErrorCode = (typeof LogConsoleErrorCode)[keyof typeof LogConsoleErrorCode]
