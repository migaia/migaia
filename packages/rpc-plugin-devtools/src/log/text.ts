/** Precompiled sink indexes keep log-level dispatch numeric after configuration. */
export const RpcLogLevel = {
  /** Debug routes an explicit user override to the logger's debug method. */
  debug: 0,
  /** Info is the default peer-lifecycle sink. */
  info: 1,
  /** Warn is the default rejection, cancellation, deadline and slow-call sink. */
  warn: 2,
  /** Error is the default sink for other failed RPC calls. */
  error: 3,
  /** Off skips message construction and the external logger boundary. */
  off: -1
} as const

/** Configuration uses stable level names; hot dispatch uses the numeric values above. */
export type RpcLogLevel = keyof typeof RpcLogLevel

/** Category indexes preserve the six option keys without string comparisons on ordinary events. */
export const RpcLogCategory = {
  /** Ordinary call failure excludes the supported cancellation and timeout families. */
  failed: 0,
  /** Admission rejection is a warning unless the user overrides its policy. */
  rejected: 1,
  /** Timeout is derived from Core identity because the frozen outcome table has no timeout slot. */
  timeout: 2,
  /** Abort is derived from Core identity because the frozen outcome table has no aborted slot. */
  aborted: 3,
  /** Settlement reaches the explicitly configured slow duration threshold. */
  slow: 4,
  /** Peer lifecycle reports endpoint-local state changes. */
  lifecycle: 5
} as const

/** Public policy keys correspond exactly to the compiled category table above. */
export type RpcLogCategory = keyof typeof RpcLogCategory

/** Logger-boundary messages remain stable across view reuse and never format ignored events. */
export const RpcLogMessage = [
  'rpc call failed',
  'rpc call rejected',
  'rpc call timed out',
  'rpc call aborted',
  'rpc call slow',
  'rpc peer lifecycle'
] as const

/** Construction diagnostics use INVALID_OPTION; callers should classify identity rather than text. */
export const RpcLogErrorText = {
  /** All four structural methods are required before logger dispatch can be compiled. */
  loggerInvalid: 'rpc log probe logger must provide debug, info, warn and error methods',
  /** The slow threshold represents elapsed milliseconds and must be finite and nonnegative. */
  slowInvalid: 'rpc log probe slowMs must be finite and nonnegative',
  /** Every level entry must identify one documented category and one supported sink. */
  levelsInvalid: 'rpc log probe levels must contain supported category and level names',
  /** Optional message, content and forwarded probe fields must conform before construction. */
  optionsInvalid: 'invalid rpc log probe options',
  /** Only the message and peer stages belong to this first-party log helper. */
  stagesInvalid: 'rpc log probe stages must contain only message and peer'
} as const
