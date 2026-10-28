/** Owns stable internal outcome tags, cancellation events and public diagnostic field paths. */

/** Outcome discriminants stay stable for budget admission and replacement callers. */
export const OutcomeKind = {
  /** Budget admission transfers one live lease to the caller. */
  granted: 'granted',
  /** Capacity or supervisor state refuses an operation without throwing an error. */
  rejected: 'rejected',
  /** Replacement returns its original startup or admission error as data. */
  failed: 'failed',
  /** Replacement publishes the generation that now owns service. */
  replaced: 'replaced'
} as const
export type OutcomeKind = (typeof OutcomeKind)[keyof typeof OutcomeKind]

/** Standard cancellation event shared by acquisition, startup and readiness listener cleanup. */
export const ABORT_EVENT = 'abort'

/** Public INVALID_OPTION detail paths remain unchanged across construction and command admission. */
export const SupervisionField = {
  /** Construction identifies the supervisor whose unit is being managed. */
  id: 'id',
  /** Construction requires the passive error outlet before resources can be owned. */
  report: 'report',
  /** Construction rejects a budget for a different profile kind. */
  budget: 'budget',
  /** Nested budget admission requires matching unit kinds. */
  parent: 'parent',
  /** Budget construction reports malformed simultaneous-unit capacity here. */
  maxUnits: 'maxUnits',
  /** Budget construction reports an invalid acquisition deadline here. */
  queueTimeoutMs: 'queueTimeoutMs',
  /** Budget construction identifies the invalid rate-count limit. */
  launchRateMax: 'launchRate.max',
  /** Budget construction identifies the invalid rolling rate duration. */
  launchRateWindowMs: 'launchRate.windowMs',
  /** Required and best-effort admission share this isolation-policy diagnostic. */
  isolation: 'isolation',
  /** Construction identifies a restart policy outside the supported domain. */
  restartMode: 'restart.mode',
  /** Construction identifies a terminal policy outside the supported domain. */
  terminalPolicyMode: 'terminalPolicy.mode',
  /** Startup deadline validation reports its public option path. */
  startupTimeoutMs: 'startupTimeoutMs',
  /** Backoff validation identifies the initial retry duration. */
  restartInitialDelayMs: 'restart.initialDelayMs',
  /** Backoff validation identifies the retry multiplier. */
  restartFactor: 'restart.factor',
  /** Backoff validation identifies the maximum retry duration. */
  restartMaxDelayMs: 'restart.maxDelayMs',
  /** Exhaustion validation identifies the allowed failure count. */
  restartMaxRestarts: 'restart.maxRestarts',
  /** Exhaustion validation identifies the rolling failure duration. */
  restartWindowMs: 'restart.windowMs',
  /** Cooldown validation identifies the delayed terminal retry duration. */
  terminalPolicyAfterMs: 'terminalPolicy.afterMs',
  /** Stop construction validates the application-drain deadline independently. */
  stopDrainTimeoutMs: 'stop.drainTimeoutMs',
  /** Stop construction validates the graceful-exit deadline independently. */
  stopExitTimeoutMs: 'stop.exitTimeoutMs',
  /** Stop construction validates the actual-exit recovery deadline independently. */
  stopReapTimeoutMs: 'stop.reapTimeoutMs',
  /** Health construction requires a positive recurring interval. */
  healthIntervalMs: 'health.intervalMs',
  /** Health construction validates each individual check deadline. */
  healthTimeoutMs: 'health.timeoutMs',
  /** Health construction validates the consecutive failure count. */
  healthFailureThreshold: 'health.failureThreshold',
  /** Replacement rejects unknown strategy before queueing or retiring a unit. */
  replaceStrategy: 'replace.strategy',
  /** Per-stop validation identifies an invalid override without superseding startup. */
  stopGraceMs: 'stop.graceMs'
} as const
export type SupervisionField = (typeof SupervisionField)[keyof typeof SupervisionField]
