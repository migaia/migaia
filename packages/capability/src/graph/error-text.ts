/** Stable diagnostic messages for graph boundary errors. */
export const CapabilityGraphErrorText = {
  /** Stable terminal-state message consumed by graph mutation/query boundaries. */
  disposed: 'capability graph is disposed',
  /** Stable registry-freeze message consumed by post-ready registration. */
  frozen: 'capability graph registry is frozen',
  /** Stable structural-admission message consumed by descriptor validation. */
  invalidNode: 'capability graph node admission failed',
  /** Stable duplicate-ID message consumed by registration. */
  duplicateNode: 'capability graph node is already registered',
  /** Stable missing-provider message consumed by topology admission. */
  unknownProvider: 'capability graph provider is not registered',
  /** Stable duplicate-edge message consumed by dependency admission. */
  duplicateEdge: 'capability graph dependency edge is duplicated',
  /** Stable cycle message consumed by topology validation. */
  dependencyCycle: 'capability graph dependency cycle detected',
  /** Stable provider-read message consumed by direct-edge checks. */
  providerUnavailable: 'capability graph provider is unavailable',
  /** Stable startup-failure message consumed by transaction failure. */
  startFailed: 'capability graph node start failed',
  /** Stable disposal-failure message consumed by release aggregation. */
  disposeFailed: 'capability graph disposal failed',
  /** Stable quiescing message consumed by closed-capability checks. */
  admissionClosed: 'capability graph admission is closed',
  /** Stable unknown-node message consumed by diagnostics lookup. */
  unknownNode: 'capability graph node is unknown',
  /** Stable reentrancy message consumed by callback guards. */
  reentrantOperation: 'capability graph operation is reentrant',
  /** Stable option-admission message consumed by factory validation. */
  invalidOption: 'capability graph option admission failed'
} as const;

export type ICapabilityGraphErrorText =
  (typeof CapabilityGraphErrorText)[keyof typeof CapabilityGraphErrorText];
