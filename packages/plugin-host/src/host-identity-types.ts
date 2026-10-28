/**
 * Defines immutable Host identity data; issuance, entropy and provenance remain with their runtime
 * owners.
 */
/** Public, immutable identity assigned by this module to one Host surface. */
export type IPluginHostIdentity = Readonly<{
  /** Human-readable label supplied by the caller, or `DEFAULT` when omitted. */
  readonly name: string
  /** Process-local identifier issued from this module's monotonic sequence. */
  readonly id: string
}>
