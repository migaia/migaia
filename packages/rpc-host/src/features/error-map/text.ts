/** Native feature identity selects one host or transport-local outbound mapper. */
export const RpcErrorMapName = 'rpc-error-map'

/** Invalid JavaScript configuration is rejected before installing any outbound stage. */
export const RpcErrorMapText = {
  mapperMustBeFunction: 'errorMap requires a mapping function',
  /** Session's outbound queue cannot wait for a developer's asynchronous error presentation. */
  mapperMustBeSynchronous: 'errorMap requires a synchronous mapping function'
} as const
