/** Standard levels interpreted by the level extension and threshold policy. */
export const LogLevel = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal'
} as const
/** The same names form the standard level type without admitting arbitrary tags. */
export type LogLevel = keyof typeof LogLevel
/** Observable host lifecycle phases; shutdown handlers run during shuttingDown. */
export const LogHostStatus = {
  active: 'active',
  flushing: 'flushing',
  shuttingDown: 'shuttingDown',
  closed: 'closed'
} as const
/** Lifecycle keys and values intentionally share their spelling. */
export type LogHostStatus = keyof typeof LogHostStatus
/** Standard levels have a fixed five-element order, independent of runtime registrations. */
export const levelOrder: Readonly<Record<string, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4
}
/** Only named built-in feature policies receive their prescribed chain positions. */
export const FeatureKind = {
  threshold: 'threshold',
  filter: 'filter',
  uuid: 'uuid',
  format: 'format',
  batch: 'batch',
  retry: 'retry',
  timeout: 'timeout'
} as const
/** Stages separate one-time entry enrichment from per-output admission and delivery. */
export const FeaturePhase = {
  entry: 'entry',
  gate: 'gate',
  format: 'format',
  delivery: 'delivery'
} as const
/** Registration identities remain stable across host installations. */
export const LogPluginName = { level: 'level', forward: 'forward' } as const
/** Explicit category levels are private data, distinct from public arbitrary tags. */
export const explicitLevel = Symbol('log.level')
/** Per-installation domain state is copied by the canonical plugin-core data boundary. */
export const logCoreOwner = Symbol('log.core.owner')
/** Entry data keys shared by producers and outputs; the values are part of the plugin contract. */
export const LogEntryDataKey = {
  /** Existing public display data survives forwarding while traversal authority stays private. */
  topicChain: 'topicChain',
  /** A producer that already streamed the text sets this to true; console skips the entry. */
  silent: 'silent'
} as const
/** The existing bounded lifecycle wait is shared by flush and shutdown. */
export const DRAIN_TIMEOUT_MS = 3000
/** Failure event provenance is shared by queue, lifecycle, forwarding and output owners. */
export const LogFailureSource = {
  defer: 'defer',
  hook: 'hook',
  sink: 'sink',
  pipeline: 'pipeline',
  flush: 'flush',
  forward: 'forward',
  shutdown: 'shutdown'
} as const
/** Built-in textual formats are normalized by one host formatter and selected by output scopes. */
export const LogFormat = { json: 'json', plain: 'plain' } as const
/** Entry identity text belongs to the entry contract rather than transport-specific rendering. */
export const LogEntryText = { id: (sequence: number): string => `log_${sequence}` } as const
