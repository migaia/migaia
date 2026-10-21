/** Log levels used by level filtering and console routing. */
export const LoggerLevel = {
  /** Lowest standard threshold, enabled by default in the level plugin. */
  debug: 'debug',
  /** Ordinary informational level above debug. */
  info: 'info',
  /** Warning level routed to console.warn by the color plugin. */
  warn: 'warn',
  /** Error level routed to console.error by the color plugin. */
  error: 'error',
  /** Highest standard threshold, rendered as fatal without itself exiting the process. */
  fatal: 'fatal'
} as const

/** Color output selection modes. */
export const LoggerColorMode = {
  /** Default environment/TTY detection, including NO_COLOR, FORCE_COLOR and CI. */
  auto: 'auto',
  /** Enable ANSI coloring independently of host detection. */
  always: 'always',
  /** Disable ANSI coloring independently of host detection. */
  never: 'never'
} as const

/** Reasoning painter phases used by the optional reasoning plugin. */
export const LoggerReasoningPhase = {
  /** No accumulated reasoning/response phase is active. */
  idle: 'idle',
  /** Thinking deltas accumulate for one later audit entry. */
  thinking: 'thinking',
  /** Response deltas accumulate for one later audit entry. */
  responding: 'responding'
} as const

/** Shutdown causes reported by the process plugin. */
export const LoggerProcessReason = {
  signal: 'signal',
  uncaughtException: 'uncaughtException',
  unhandledRejection: 'unhandledRejection'
} as const

/** Console severity tags routed to the corresponding console method. */
export const LoggerConsoleTag = {
  error: 'error',
  fatal: 'fatal',
  warn: 'warn'
} as const

/** Standard threshold labels understood by the optional level plugin. */
export type ILoggerLevel = (typeof LoggerLevel)[keyof typeof LoggerLevel]
/** Environment-driven, forced-on or forced-off ANSI selection. */
export type ILoggerColorMode = (typeof LoggerColorMode)[keyof typeof LoggerColorMode]
/** Current reasoning renderer phase, distinct from Logger lifetime. */
export type ILoggerReasoningPhase = (typeof LoggerReasoningPhase)[keyof typeof LoggerReasoningPhase]

/** Public entry.data display key shared by core forwarding snapshots and the color renderer. */
export const LoggerEntryDataKey = { topicChain: 'topicChain' } as const
