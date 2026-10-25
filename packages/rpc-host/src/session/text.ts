/** Stable protocol coordination diagnostics for the actual session owner. */
export const SessionText = {
  /** Business frames cannot execute before the host accepts both identity and directory. */
  handshakeRequired: 'RPC session handshake is not complete',
  /** A physical source cannot replace its accepted direct peer identity in a later frame. */
  identityMismatch: 'RPC session identity does not match its physical source',
  /** New-profile negotiation admits one deterministic agreement on each connection. */
  handshakeUnexpected: 'RPC session handshake step is unexpected',
  /** Default size is the retained native frame ceiling; specific carriers may configure less. */
  defaultMaxFrameBytes: 16_777_216,
  /** Existing host control pings have their own bounded health clock, separate from call features. */
  defaultControlTimeoutMs: 1000,
  /** Silent bootstrap retains the original ten-second startup deadline across every carrier. */
  defaultHandshakeTimeoutMs: 10_000,
  /** Same-name admission retains the existing connect probe deadline. */
  defaultNameProbeTimeoutMs: 10_000,
  /** Common JSON bootstrap has the retained first-message ceiling. */
  handshakeMaxFrameBytes: 65_536
} as const
