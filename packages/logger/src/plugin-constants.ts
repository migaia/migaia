/** Log levels used by level filtering and console routing. */
export const LoggerLevel = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal'
} as const;

/** Color output selection modes. */
export const LoggerColorMode = { auto: 'auto', always: 'always', never: 'never' } as const;

/** Reasoning painter phases used by the optional reasoning plugin. */
export const LoggerReasoningPhase = {
  idle: 'idle',
  thinking: 'thinking',
  responding: 'responding'
} as const;

/** Shutdown causes reported by the process plugin. */
export const LoggerProcessReason = {
  signal: 'signal',
  uncaughtException: 'uncaughtException',
  unhandledRejection: 'unhandledRejection'
} as const;

/** Console severity tags routed to the corresponding console method. */
export const LoggerConsoleTag = {
  error: 'error',
  fatal: 'fatal',
  warn: 'warn'
} as const;

export type ILoggerLevel = (typeof LoggerLevel)[keyof typeof LoggerLevel];
export type ILoggerColorMode = (typeof LoggerColorMode)[keyof typeof LoggerColorMode];
export type ILoggerReasoningPhase =
  (typeof LoggerReasoningPhase)[keyof typeof LoggerReasoningPhase];
