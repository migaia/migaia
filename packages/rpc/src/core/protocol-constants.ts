/** Provider-control kinds used by endpoint resource admission. */
export const RpcControlKind = {
  request: 'request',
  dispatch: 'dispatch',
  ping: 'ping',
  discovery: 'discovery'
} as const

/** Hook event names emitted by chunk admission and expiry handling. */
export const RpcChunkEvent = {
  rejected: 'chunk.rejected',
  expired: 'chunk.expired'
} as const

export type IRpcChunkEvent = (typeof RpcChunkEvent)[keyof typeof RpcChunkEvent]
export type IRpcControlKind = (typeof RpcControlKind)[keyof typeof RpcControlKind]
