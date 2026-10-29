/** Stable console color modes control explicit ANSI policy before host environment detection. */
export const ConsoleColorMode = {
  /** Follow environment and TTY capabilities when no explicit policy wins. */
  auto: 'auto',
  /** Emit ANSI even when the borrowed output is not a terminal. */
  always: 'always',
  /** Suppress ANSI regardless of host environment. */
  never: 'never'
} as const

/** Runtime and type values intentionally share the same enum-like namespace. */
export type ConsoleColorMode = keyof typeof ConsoleColorMode

/** Environment keys retain the existing console formatting and color precedence. */
export const ConsoleEnvironmentKey = {
  /** Explicit json or pretty output wins over CI and TTY auto selection. */
  format: 'LOG_FORMAT',
  /** Disable automatic ANSI even when a force-color value is present. */
  noColor: 'NO_COLOR',
  /** A nonzero value enables automatic ANSI before TTY detection. */
  forceColor: 'FORCE_COLOR',
  /** CI logs retain the established human-readable and colored output policy. */
  ci: 'CI'
} as const

/** Console output modes remain separate from the host's unique format-scope policy. */
export const ConsoleFormat = {
  /** Structured text is produced solely by the host's JSON formatter. */
  json: 'json',
  /** Native pretty delivery preserves original object and Error arguments. */
  pretty: 'pretty'
} as const

/** The console is a stable output registration rather than a global runtime manager. */
export const CONSOLE_PLUGIN_NAME = 'console'

/** Forwarded display topics use the existing ordinary entry data field. */
export const TOPIC_CHAIN_DATA_KEY = 'topicChain'
