/** Canonical public diagnostics for errors emitted by the supervisor and profiles. */
export const SupervisionErrorText = {
  /** Construction and profile validation failures use this stable public diagnostic. */
  invalidOption: 'supervision option is invalid',
  /** Admission failure when a required capability lacks a sufficient guarantee. */
  capabilityUnsupported: 'supervision capability is unsupported',
  /** Wraps launcher, attachment, or ready-hook failure while retaining its cause. */
  launchFailed: 'unit launch failed',
  /** Startup deadline diagnostic for an attempt that never reached ready. */
  startupTimeout: 'unit startup timed out',
  /** Running or starting unit exit reported by the supervisor. */
  exitUnexpected: 'unit exited unexpectedly',
  /** Repeated health check failures and missed heartbeats surface through this text. */
  unhealthy: 'unit is unhealthy',
  /** Profile resource monitor failure text shared across unit kinds. */
  resourceLimitExceeded: 'unit resource limit exceeded',
  /** Bounded launch or exit recovery ended before the unit disappeared. */
  reapTimeout: 'unit recovery timed out',
  /** Restart policy exhausted its window and entered terminal state. */
  supervisionExhausted: 'supervision restart limit exhausted',
  /** Unit-producing command attempted while disposal is in progress. */
  scopeClosed: 'supervisor is closing',
  /** Unit-producing command attempted after disposal completed. */
  scopeTerminal: 'supervisor is disposed',
  /** Coroutine progress probe exceeded its configured heartbeat window. */
  heartbeatMissed: 'coroutine heartbeat missed',
  /** Prior-run process recovery failed while leaving its registry record available for retry. */
  orphanReclaimFailed: 'orphan process reclaim failed'
} as const
