/** Data/cache state exposed by Resource.state and Resource.read(). */
export const ResourceStatus = {
  /** No data or request result has been published. */
  idle: 'idle',
  /** Initial data is still being requested. */
  pending: 'pending',
  /** Cached data is available, including during background refresh. */
  success: 'success',
  /** The most recent request failed. */
  error: 'error',
  /** Explicit cancellation published a stable AbortError result. */
  cancelled: 'cancelled'
} as const

export type ResourceStatus = keyof typeof ResourceStatus

/** Transport activity is independent from cached data status during background refresh. */
export const ResourceFetchStatus = {
  /** No current request is running. */
  idle: 'idle',
  /** A request is running, with or without cached data. */
  fetching: 'fetching'
} as const

export type ResourceFetchStatus = keyof typeof ResourceFetchStatus
