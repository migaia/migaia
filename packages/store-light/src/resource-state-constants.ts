/** Resource request states exposed by the store-light resource layer. */
export const StoreResourceKind = {
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  failed: 'failed',
  closing: 'closing',
  disposed: 'disposed'
} as const

/** Visible resource data states, separate from request lifecycle. */
export const StoreResourceDataKind = {
  empty: 'empty',
  value: 'value',
  error: 'error'
} as const

/** Store facade initialization states used while creating field-backed values. */
export const StoreInitializationStatus = {
  pending: 'pending',
  ready: 'ready',
  failed: 'failed'
} as const

export type IStoreResourceKind = (typeof StoreResourceKind)[keyof typeof StoreResourceKind]
export type IStoreResourceDataKind =
  (typeof StoreResourceDataKind)[keyof typeof StoreResourceDataKind]
export type IStoreInitializationStatus =
  (typeof StoreInitializationStatus)[keyof typeof StoreInitializationStatus]
