/** Stable error domain owned by this code table; package moves preserve this identity. */
export const ERROR_SOURCE = 'supervision'

/** Errors produced by the unit-neutral supervisor keep one package identity. */
export const SUPERVISION_SOURCE = ERROR_SOURCE

/** Stable semantic codes shared by all unit profiles. */
export const SupervisionErrorCode = {
  /** Invalid constructor or profile option; callers must correct the configuration. */
  invalidOption: 'INVALID_OPTION',
  /**
   * Required unit capability is not enforced or monitored; choose another launcher or isolation
   * mode.
   */
  capabilityUnsupported: 'CAPABILITY_UNSUPPORTED',
  /**
   * Launch, preacquired-unit adoption, attachment, or readiness failed; inspect detail.phase and
   * the original cause.
   */
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
  /**
   * Forced recovery cannot observe unit exit because the launcher declares exit-observation
   * unsupported; retain its lease until actual exit. Enforces the declared exit-observation
   * boundary; choose an observable launcher when confirmed recovery is required.
   */
  exitUnobservable: 'EXIT_UNOBSERVABLE',
  /** Restarts exceeded the policy window; inspect the final failure and reset explicitly. */
  supervisionExhausted: 'SUPERVISION_EXHAUSTED',
  /** A command attempted to create a unit while disposal is in progress; wait for disposal. */
  scopeClosed: 'SCOPE_CLOSED',
  /** A command attempted to create a unit after disposal; create a new supervisor. */
  scopeTerminal: 'SCOPE_TERMINAL',
  /** A coroutine stopped making progress; inspect its heartbeat and terminate it cooperatively. */
  heartbeatMissed: 'HEARTBEAT_MISSED',
  /**
   * Registry listing or a prior process record recovery failed; inspect detail.step, retain
   * records, and retry after inspection.
   */
  orphanReclaimFailed: 'ORPHAN_RECLAIM_FAILED'
} as const

export type ISupervisionErrorCode = (typeof SupervisionErrorCode)[keyof typeof SupervisionErrorCode]
