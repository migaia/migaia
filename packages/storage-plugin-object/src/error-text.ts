/** Stable public failure text stays independent of paths, keys, credentials and native details. */
export const ObjectErrorText = {
  /** Native I/O failed and its exact error remains on cause. */
  failed: 'object operation failed',
  /** Existing persisted data cannot be decoded safely. */
  dataInvalid: 'object data is invalid',
  /** A dispatched atomic commit has no confirmed outcome. */
  commitUnknown: 'object commit outcome is unknown',
  /** Factories and native-only options must be valid before side effects. */
  argument: 'object driver options are invalid',
  /** One real directory permits only one active object writer in this process. */
  rootOccupied: 'object filesystem root already has an active writer',
  /** The caller must keep every input chunk inside the shared byte domain. */
  chunk: 'object upload stream must contain Uint8Array chunks',
  /** Only active store resources admit new operations. */
  disposed: 'object store is disposed',
  /** An opaque page belongs to one backend, organization and prefix. */
  cursor: 'object page cursor does not match this query',
  /** Known native conditions reject before upload reader ownership. */
  conflict: 'object write condition failed',
  /** Failed probe diagnostics stay outside ordinary operation hooks. */
  conditional: 'object service does not support conditional writes',
  /** Probe cleanup diagnostics identify the reserved probe object for explicit operator cleanup. */
  probeCleanup: (key: string): string => `object probe cleanup failed: ${key}`
} as const
