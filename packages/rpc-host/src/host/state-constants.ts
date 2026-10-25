/** Mandatory host lifecycle observation vocabulary; optional probes consume these readonly events. */
/** Hook events expose ignored protocol fields and peer close intent to endpoint observers. */
export const RpcProtocolEvent = {
  /** An unrecognized field or control subtype was ignored and reported once per connection. */
  unknownField: 'protocol.unknown-field',
  /** A peer announced a relative drain window before its channel closes. */
  peerClosing: 'control.close'
} as const

export type IRpcProtocolEvent = (typeof RpcProtocolEvent)[keyof typeof RpcProtocolEvent]

/** Host-owned lifecycle names do not enable any concrete observation plugin. */
export const HostObservationKind = {
  /** A physical handshake and directory admission have actually published the accepted session. */
  peerReady: 'peer-ready',
  /** Actual physical retirement has removed this generation from all host work owners. */
  peerLeave: 'peer-leave'
} as const
