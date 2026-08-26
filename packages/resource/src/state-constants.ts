/** Resource request states exposed to consumers. */
export const ResourceStatus = {
  idle: 'idle',
  pending: 'pending',
  success: 'success',
  error: 'error',
  cancelled: 'cancelled',
  fetching: 'fetching'
} as const

export type IResourceStatus = (typeof ResourceStatus)[keyof typeof ResourceStatus]
