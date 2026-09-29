/** Errors produced by the unit-neutral supervisor keep one package identity. */
export const SUPERVISION_SOURCE = '@migaia/supervision'

/** Stable semantic codes shared by all unit profiles. */
export const SupervisionErrorCode = {
  /** Invalid constructor or profile option; callers must correct the configuration. */
  invalidOption: 'INVALID_OPTION',
  /**
   * Required unit capability is not enforced or monitored; choose another launcher or isolation
   * mode.
   */
  capabilityUnsupported: 'CAPABILITY_UNSUPPORTED',
  /** Launch, attachment, or readiness failed; inspect detail.phase and the original cause. */
  launchFailed: 'LAUNCH_FAILED',
  /** Startup did not reach ready within its deadline; inspect the stopped attempt. */
  startupTimeout: 'STARTUP_TIMEOUT',
  /** A running unit exited unexpectedly; inspect its original status or cause. */
  exitUnexpected: 'EXIT_UNEXPECTED',
  /** Health checks crossed the failure threshold; replace or restart the unit. */
  unhealthy: 'UNHEALTHY',
  /** A monitored resource limit was violated; inspect the limit detail before retrying. */
  resourceLimitExceeded: 'RESOURCE_LIMIT_EXCEEDED',
  /** The unit did not exit within its recovery deadline; retain its lease until it actually exits. */
  reapTimeout: 'REAP_TIMEOUT',
  /** Restarts exceeded the policy window; inspect the final failure and reset explicitly. */
  supervisionExhausted: 'SUPERVISION_EXHAUSTED',
  /** A command attempted to create a unit while disposal is in progress; wait for disposal. */
  scopeClosed: 'SCOPE_CLOSED',
  /** A command attempted to create a unit after disposal; create a new supervisor. */
  scopeTerminal: 'SCOPE_TERMINAL',
  /** A coroutine stopped making progress; inspect its heartbeat and terminate it cooperatively. */
  heartbeatMissed: 'HEARTBEAT_MISSED',
  /** A prior process record could not be reclaimed; retain it and retry recovery after inspection. */
  orphanReclaimFailed: 'ORPHAN_RECLAIM_FAILED'
} as const

export type ISupervisionErrorCode = (typeof SupervisionErrorCode)[keyof typeof SupervisionErrorCode]
