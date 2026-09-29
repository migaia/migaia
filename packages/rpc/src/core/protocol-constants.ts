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

/** Hook events expose ignored protocol fields and peer close intent to endpoint observers. */
export const RpcProtocolEvent = {
  /** An unrecognized field or control subtype was ignored and reported once per connection. */
  unknownField: 'protocol.unknown-field',
  /** A peer announced a relative drain window before its channel closes. */
  peerClosing: 'control.close'
} as const

export type IRpcProtocolEvent = (typeof RpcProtocolEvent)[keyof typeof RpcProtocolEvent]
