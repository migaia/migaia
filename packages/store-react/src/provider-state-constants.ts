/** Store provider readiness states used during hydration and startup. */
export const StoreProviderState = {
  /** At least one normalized barrier has not settled; Provider renders fallback. */
  pending: 'pending',
  /** All barriers fulfilled and the child subtree may render. */
  ready: 'ready',
  /** A barrier rejected; the Provider raises its normalized error during rendering. */
  error: 'error'
} as const

/** Empty serialized feature map used as the canonical no-feature snapshot. */
export const EMPTY_EXPERIMENTAL_ENCODING = '[]'

/** Public normalized readiness-status values, distinct from thrown error codes. */
export type IStoreProviderState = (typeof StoreProviderState)[keyof typeof StoreProviderState]
