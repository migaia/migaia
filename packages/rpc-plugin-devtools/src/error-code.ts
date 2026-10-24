/** Registry identity shared by all devtools errors; consumers classify the source/code pair. */
export const ERROR_SOURCE = 'rpc.devtools'

/** Public code owner for the record contract and collector lifecycle. */
export const RpcDevtoolsErrorCode = {
  /** Captured service data cannot be encoded; inspect cause or disable content exposure. */
  serviceResultInvalid: 'SERVICE_RESULT_INVALID',
  /** Collector options violate their supported domain; fix the option before construction. */
  invalidOption: 'INVALID_OPTION',
  /** Collector is closed; create a new instance rather than reviving retained resources. */
  closed: 'CLOSED',
  /** A recording already owns the collector; stop it before starting another. */
  recordActive: 'RECORD_ACTIVE',
  /** No recording remains active; start one before stopping it. */
  recordNotActive: 'RECORD_NOT_ACTIVE',
  /** Record header or NDJSON is invalid; inspect cause and supply a version-1 record. */
  recordFormatInvalid: 'RECORD_FORMAT_INVALID',
  /** Redaction failed; report the original cause and discard content (collector). */
  redactFailed: 'REDACT_FAILED'
} as const

/** Semantic code union retains the registry's exact value spelling. */
export type IRpcDevtoolsErrorCode = (typeof RpcDevtoolsErrorCode)[keyof typeof RpcDevtoolsErrorCode]
