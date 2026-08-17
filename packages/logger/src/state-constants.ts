/** Logger core lifecycle states. */
export const LoggerStatus = {
  active: 'active',
  flushing: 'flushing',
  shuttingDown: 'shutting-down',
  closed: 'closed'
} as const;

export type ILoggerStatus = (typeof LoggerStatus)[keyof typeof LoggerStatus];
