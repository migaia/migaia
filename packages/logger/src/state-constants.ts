/** Logger core lifecycle states. */
export const LoggerStatus = {
  /** Normal dispatch and plugin operation phase. */
  active: 'active',
  /** An in-flight flush temporarily shares one drain completion. */
  flushing: 'flushing',
  /** Terminal shutdown is admitted; final handlers precede plugin disposal. */
  shuttingDown: 'shutting-down',
  /** Terminal state: later log/raw admission is ignored rather than restarted. */
  closed: 'closed'
} as const

/** Logger lifecycle labels; these are states rather than thrown error codes. */
export type ILoggerStatus = (typeof LoggerStatus)[keyof typeof LoggerStatus]
