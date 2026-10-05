/** Observable supervisor lifecycle states. */
export const SupervisorState = {
  idle: 'idle',
  queued: 'queued',
  starting: 'starting',
  ready: 'ready',
  backoff: 'backoff',
  stopping: 'stopping',
  stopped: 'stopped',
  terminal: 'terminal',
  disposed: 'disposed'
} as const
export type SupervisorState = (typeof SupervisorState)[keyof typeof SupervisorState]

/** Health observations belong to the original serialized monitor, independent of unit readiness. */
export const HealthState = {
  pending: 'pending',
  checking: 'checking',
  healthy: 'healthy',
  unhealthy: 'unhealthy'
} as const
export type HealthState = (typeof HealthState)[keyof typeof HealthState]

/** Why a unit ceased to run. */
export const ExitReason = {
  exited: 'exited',
  crashed: 'crashed',
  stopped: 'stopped',
  killed: 'killed',
  abandoned: 'abandoned',
  launchFailed: 'launch-failed',
  startupTimeout: 'startup-timeout',
  unhealthy: 'unhealthy',
  resourceViolation: 'resource-violation'
} as const
export type ExitReason = (typeof ExitReason)[keyof typeof ExitReason]

/** Automatic restart selection. */
export const RestartMode = { never: 'never', onFailure: 'on-failure', always: 'always' } as const
export type RestartMode = (typeof RestartMode)[keyof typeof RestartMode]

/** Behavior after the restart window is exhausted. */
export const TerminalPolicyMode = { stay: 'stay', cooldown: 'cooldown' } as const
export type TerminalPolicyMode = (typeof TerminalPolicyMode)[keyof typeof TerminalPolicyMode]

/** Replacement ordering relative to the currently active unit. */
export const ReplaceStrategy = {
  stopThenStart: 'stop-then-start',
  startThenSwitch: 'start-then-switch'
} as const
export type ReplaceStrategy = (typeof ReplaceStrategy)[keyof typeof ReplaceStrategy]

/** Strength of a launcher capability guarantee. */
export const CapabilityLevel = {
  enforced: 'enforced',
  monitored: 'monitored',
  cooperative: 'cooperative',
  unsupported: 'unsupported'
} as const
export type CapabilityLevel = (typeof CapabilityLevel)[keyof typeof CapabilityLevel]

/** Admission strictness for a requested capability. */
export const IsolationMode = { required: 'required', bestEffort: 'best-effort' } as const
export type IsolationMode = (typeof IsolationMode)[keyof typeof IsolationMode]

/** Termination request sent to a unit profile. */
export const TerminationMode = { graceful: 'graceful', force: 'force' } as const
export type TerminationMode = (typeof TerminationMode)[keyof typeof TerminationMode]

/** Action when a budget cannot grant immediately. */
export const BudgetOverflow = { queue: 'queue', reject: 'reject' } as const
export type BudgetOverflow = (typeof BudgetOverflow)[keyof typeof BudgetOverflow]

/** Nonthrowing budget denial reasons. */
export const BudgetRejection = {
  full: 'full',
  rateLimited: 'rate-limited',
  queueTimeout: 'queue-timeout',
  aborted: 'aborted',
  closed: 'closed'
} as const
export type BudgetRejection = (typeof BudgetRejection)[keyof typeof BudgetRejection]

/** Phase of an unsuccessful startup. */
export const LaunchPhase = { launch: 'launch', attach: 'attach', ready: 'ready' } as const
export type LaunchPhase = (typeof LaunchPhase)[keyof typeof LaunchPhase]

/** Command or timer responsible for starting an attempt. */
export const LaunchCause = {
  start: 'start',
  restart: 'restart',
  replace: 'replace',
  backoff: 'backoff',
  cooldown: 'cooldown'
} as const
export type LaunchCause = (typeof LaunchCause)[keyof typeof LaunchCause]

/** Event discriminants published by a supervisor. */
export const SupervisorEventType = {
  state: 'state',
  exit: 'exit',
  terminal: 'terminal',
  switched: 'switched',
  /** Successful manual or automatic restart, not a generation-number inference. */
  restart: 'restart',
  /** The original admitted capability degradation set changed. */
  degraded: 'degraded'
} as const
export type SupervisorEventType = (typeof SupervisorEventType)[keyof typeof SupervisorEventType]

/** Capability keys common to every execution profile. */
export const StandardCapability = {
  termination: 'termination',
  faultIsolation: 'fault-isolation'
} as const
export type StandardCapability = (typeof StandardCapability)[keyof typeof StandardCapability]
