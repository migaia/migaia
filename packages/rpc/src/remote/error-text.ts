/** Stable messages exposed by the remote layer's coded errors. */
export const RpcRemoteLayerErrorText = {
  /** Slow passive consumers fail explicitly instead of silently losing lifecycle facts. */
  runtimeEventOverflow: 'Runtime event watch buffer overflowed',
  /** Replaces malformed untrusted keys in contract diagnostics without reflecting input. */
  invalidPathSegment: '<invalid-key>',
  /** Used for invalid descriptions and reserved control payloads. */
  contractInvalid: 'Remote contract is invalid',
  /** Removal admission requires a live connection-owned remote Host adoption (R4/K203). */
  hostNotAdopted: 'Remote Host plugin is not adopted by this connection',
  /** Used when unit startup or channel acquisition cannot complete. */
  startFailed: 'Remote unit could not start',
  /** Used when a registration or generation can no longer accept work. */
  closed: 'Remote generation is closed',
  /** A sent request may have executed even though its result was lost on departure. */
  resultUnknown: 'Remote request result is unknown',
  /** Core capability conflict when a declared remote stream cannot be opened. */
  streamUnavailable: 'Remote stream capability is unavailable',
  /** Core capability conflict when an endpoint lacks one-way sending. */
  oneWayUnavailable: 'Remote one-way capability is unavailable'
} as const
