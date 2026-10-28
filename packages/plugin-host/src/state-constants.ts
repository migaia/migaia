/**
 * Owns stable Host, registration, cleanup and activation state vocabulary; state values are never
 * thrown error codes.
 */
export const PluginHostStatus = {
  /** Accepts new operations; existing registrations can publish through their normal guards. */
  active: 'active',
  /** Disposal closed admission; accepted work and cleanup may still be settling. */
  closing: 'closing',
  /** Logical terminal state; physicalCompletion can still describe outstanding cleanup. */
  disposed: 'disposed'
} as const

/** Registration lifecycle used to guard plugin-owned resources. */
export const PluginHostRegistrationLifecycle = {
  /** No installation/disposal hook is currently acquiring registration resources. */
  idle: 'idle',
  /** Current install attempt may acquire resources and stages before publication. */
  install: 'install',
  /** Registration capabilities are being revoked and released; new acquisition is rejected. */
  dispose: 'dispose'
} as const

/**
 * Internal physical-cleanup policy: bounded steps degrade; explicit unbounded cleanup awaits each
 * release.
 */
export const PluginHostCleanupMode = {
  bounded: 'bounded',
  unbounded: 'unbounded'
} as const

export type PluginHostCleanupMode =
  (typeof PluginHostCleanupMode)[keyof typeof PluginHostCleanupMode]

/** Host lifecycle vocabulary; values describe state rather than thrown errors. */
export type IPluginHostStatus = (typeof PluginHostStatus)[keyof typeof PluginHostStatus]
/** Hook/resource-acquisition phase vocabulary for one registration. */
export type IPluginHostRegistrationLifecycle =
  (typeof PluginHostRegistrationLifecycle)[keyof typeof PluginHostRegistrationLifecycle]

/** Installation timing values shared by raw/trusted admission and capability install-set selection. */
export const PluginActivation = {
  /** Eager definitions construct during installation unless another prerequisite rejects the batch. */
  eager: 'eager',
  /** Lazy definitions retain cold registration identity until explicitly or transitively activated. */
  lazy: 'lazy'
} as const

/** Exact activation vocabulary; runtime values and the same-named union have one owner. */
export type PluginActivation = (typeof PluginActivation)[keyof typeof PluginActivation]
