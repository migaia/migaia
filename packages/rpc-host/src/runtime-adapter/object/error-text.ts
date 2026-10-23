/** Stable diagnostics identify invalid sequencing at the ordinary held-object resource boundary. */
export const RuntimeObjectErrorText = {
  /** A local proposal must be prepared before the resource can exchange its handshake. */
  preparationRequired: 'Adapter object connection requires a prepared local offer',
  /** Once exchange starts, replacing its local proposal would detach validation from that write. */
  preparationStarted: 'Adapter object connection handshake has already started',
  /** Final transport construction is available only after Core accepts the actual peer reply. */
  negotiationRequired: 'Adapter object connection requires a completed handshake',
  /** This text/object carrier constructs the canonical JSON codec rather than an identity codec. */
  jsonCodecRequired: 'Adapter object connection requires the JSON codec'
} as const
