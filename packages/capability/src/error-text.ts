/** Stable capability admission messages shared by option validation and snapshot failures. */
export const CapabilityErrorText = {
  /** Stable admission diagnostic for readiness values outside the public graph contract. */
  invalidReadinessState: 'capability readiness state is invalid',
  /** Explains that a public host option getter failed before lifecycle state was allocated. */
  optionsSnapshotFailed: 'capability options snapshot failed',
  /** Explains that the public host options container must support property reads. */
  invalidOptions: 'capability options must be an object or function',
  /** Explains that the flags object could not be copied without executing its values. */
  flagsSnapshotFailed: 'capability flags snapshot failed',
  /** Explains that error reporting must be callable when the host is created. */
  invalidOnError: 'capability onError must be a function',
  /** Explains that a second in-progress dispose cannot join the first completion promise. */
  hostTransitioning: 'capability host cannot mutate during a lifecycle transition',
  /** Builds stable invalid-handle text while preserving the registered capability name. */
  invalidHandle: (name: string): string => `capability "${name}" returned an invalid handle`
} as const;

export type ICapabilityErrorText = (typeof CapabilityErrorText)[keyof typeof CapabilityErrorText];
