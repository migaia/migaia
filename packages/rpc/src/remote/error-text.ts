/** Stable messages exposed by the remote layer's coded errors. */
export const RpcRemoteLayerErrorText = {
  /** Used for invalid descriptions and reserved control payloads. */
  contractInvalid: 'Remote contract is invalid',
  /** Used when unit startup or channel acquisition cannot complete. */
  startFailed: 'Remote unit could not start',
  /** Used when a registration or generation can no longer accept work. */
  closed: 'Remote generation is closed',
  /** Core capability conflict when a declared remote stream cannot be opened. */
  streamUnavailable: 'Remote stream capability is unavailable',
  /** Core capability conflict when an endpoint lacks one-way sending. */
  oneWayUnavailable: 'Remote one-way capability is unavailable'
} as const
