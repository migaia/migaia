/** Stable measurement diagnostics shared by the frozen CLI, session owner and raw receipts. */
export const IpcBenchErrorText = Object.freeze({
  /** Missing equivalent PID roles invalidate the paired denominator. */
  endpoint: 'Incomplete endpoint attribution',
  /** Both sides must retain complete observations before DA1 can judge a ratio. */
  paired: 'Incomplete paired measurement',
  /** Native latencies are positive; browser quantized zero samples require explicit opt-in. */
  latency: 'Invalid measured latency samples',
  /** Sampling requires a bounded lane count and an independently prestarted PID observer. */
  configuration: 'Invalid bare measurement configuration',
  /** A snapshot must contain exactly the independently charged PID set. */
  pid: 'Missing or duplicate PID observation',
  /** CPU and absolute RSS denominators cannot be inferred from another process. */
  resource: 'Missing CPU or absolute RSS observation',
  /** Preserve the measurement failure first when observer cleanup also fails. */
  observerCleanup: 'Measurement and observer cleanup failed',
  /** Counter rollback or an empty elapsed window cannot yield a valid rate. */
  window: 'Invalid CPU or elapsed measurement window',
  /** Historical totals must agree with the retained independent PID observations. */
  totals: 'Inconsistent endpoint totals',
  /** Bare and RPC must perform the same frozen business workload. */
  mismatch: 'Paired configuration mismatch',
  /** A missing or nonpositive denominator cannot pass any relative budget. */
  ratio: 'Invalid paired ratio',
  /** All three original pairs are required; incomplete runs are retained as errors. */
  rounds: 'At least three paired rounds required',
  /** Alternation is part of the frozen measurement method. */
  order: 'Paired order must alternate',
  /** Selection cannot silently omit supported cells or reinterpret an unfrozen inventory. */
  inventory: 'Support inventory is not frozen',
  /** The first side failure remains reachable if session cleanup also fails. */
  sideCleanup: 'IPC side and cleanup failed',
  /** Bare physical framing uses the same supported carrier byte limit. */
  bareFrame: 'Bare frame outside carrier limit',
  /** Native RPC echoes must preserve the original business payload. */
  echo: 'RPC echo mismatch',
  /** Native session disposal preserves every original cleanup failure. */
  cleanup: 'IPC cleanup failed',
  /** Failed native construction cannot lose its primary error during rollback. */
  preparationCleanup: 'IPC preparation and cleanup failed',
  /** Foreign bridge cells require an actually delivered peer runtime. */
  bridgeRuntime: 'Undelivered bridge peer runtime',
  /** Foreign bridge cells require an actually delivered Content-Length carrier. */
  bridgeCarrier: 'Undelivered bridge carrier',
  /** Foreign bridge echoes must preserve the same business payload. */
  bridgeEcho: 'Bridge RPC echo mismatch',
  /** Foreign cleanup errors remain separate from the original measurement failure. */
  bridgeCleanup: 'Bridge IPC cleanup failed',
  /** Foreign preparation rollback preserves the primary setup failure. */
  bridgePreparation: 'Bridge IPC preparation failed',
  /** This fixture's explicit local authentication token is checked before native readiness. */
  authentication: 'Benchmark authentication failed',
  /**
   * Raw side stderr stays attached to its actual exit rather than becoming a ratio failure.
   *
   * @param {number | null} code Actual side exit status.
   * @param {string} stderr Retained redacted side diagnostic.
   * @returns {string} Stable raw failure context.
   */
  sideFailed: (code, stderr) => `IPC side preparation/measurement failed (${code}): ${stderr}`,
  /**
   * Carrier selection failure is a capability error, never an unsupported rewrite after timing.
   *
   * @param {string} carrier Selected frozen physical carrier.
   * @returns {string} Stable capability diagnostic.
   */
  carrier: (carrier) => `Undelivered carrier: ${carrier}`
})
