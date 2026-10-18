/** Registry identity shared by all devtools errors; consumers classify the source/code pair. */
export const ERROR_SOURCE = '@migaia/rpc/devtools'

/** Public code owner for contract R5/S5 and the collector/hub lifecycle clauses. */
export const RpcDevtoolsErrorCode = {
  /**
   * Captured service data cannot be encoded (closure R5); inspect cause or disable content
   * exposure.
   */
  serviceResultInvalid: 'SERVICE_RESULT_INVALID',
  /** Collector/hub options violate their supported domain; fix the option before construction (R5). */
  invalidOption: 'INVALID_OPTION',
  /**
   * Runtime is absent or the instance is closed; install the runtime or create a live instance
   * (R5).
   */
  closed: 'CLOSED',
  /** A recording already owns the collector; stop it before starting another (collector R3). */
  recordActive: 'RECORD_ACTIVE',
  /** No recording remains active; start one before stopping it (collector R3). */
  recordNotActive: 'RECORD_NOT_ACTIVE',
  /** Record header or NDJSON is invalid; inspect cause and supply a version-1 record (contract R4). */
  recordFormatInvalid: 'RECORD_FORMAT_INVALID',
  /** Redaction failed; report the original cause and discard content (collector §5). */
  redactFailed: 'REDACT_FAILED',
  /** A hub target name is registered; remove it before replacement (hub R1). */
  targetDuplicate: 'TARGET_DUPLICATE',
  /** A hub operation names an unknown target; register it before use (hub R1). */
  targetUnknown: 'TARGET_UNKNOWN',
  /**
   * Hub close reports failed target iterator returns; inspect original cause/errors and fix
   * cleanup.
   */
  targetReleaseFailed: 'TARGET_RELEASE_FAILED'
} as const

/** Semantic code union retains the registry's exact value spelling. */
export type IRpcDevtoolsErrorCode = (typeof RpcDevtoolsErrorCode)[keyof typeof RpcDevtoolsErrorCode]
