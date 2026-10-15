/** Resource request states exposed by the store-light resource layer. */
export const StoreResourceKind = {
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  failed: 'failed',
  closing: 'closing',
  disposed: 'disposed'
} as const

/** Store facade initialization states used while creating field-backed values. */
export const StoreInitializationStatus = {
  pending: 'pending',
  ready: 'ready',
  failed: 'failed'
} as const

export type IStoreResourceKind = (typeof StoreResourceKind)[keyof typeof StoreResourceKind]
export type IStoreInitializationStatus =
  (typeof StoreInitializationStatus)[keyof typeof StoreInitializationStatus]

/** Stable failure phases passed to StoreResource user diagnostics. */
export const StoreResourceErrorPhase = {
  /** Loading or validating a factory-produced value failed. */
  load: 'load',
  /** Releasing a value or invoking terminal housekeeping failed. */
  dispose: 'dispose',
  /** Publishing a revision reached a throwing or rejecting subscriber. */
  listener: 'listener'
} as const

/** Diagnostic phase keys shared by the StoreResource callback contract. */
export type StoreResourceErrorPhase = keyof typeof StoreResourceErrorPhase
