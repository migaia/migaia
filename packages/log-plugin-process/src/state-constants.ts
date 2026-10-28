/** The stable peer registration key identifies one host's process integration. */
export const PROCESS_PLUGIN_NAME = 'process'

/** Event names are shared by group installation, cleanup and crash handling. */
export const ProcessEvent = {
  /** Interactive interruption requests a graceful zero-code exit. */
  sigint: 'SIGINT',
  /** Termination requests a graceful zero-code exit. */
  sigterm: 'SIGTERM',
  /** Natural event-loop exhaustion requests a flush without forcing exit. */
  beforeExit: 'beforeExit',
  /** An uncaught native error requests fatal capture and error-code exit. */
  uncaughtException: 'uncaughtException',
  /** A rejected Promise requests fatal capture and error-code exit. */
  unhandledRejection: 'unhandledRejection'
} as const

/** Shutdown causes retain the host's public reason values. */
export const ProcessReason = {
  /** Both OS termination events share one logical shutdown trigger. */
  signal: 'signal',
  /** Crash events use their same canonical event-name spelling as the reason. */
  uncaughtException: ProcessEvent.uncaughtException,
  /** Rejection events use their same canonical event-name spelling as the reason. */
  unhandledRejection: ProcessEvent.unhandledRejection
} as const
