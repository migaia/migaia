/** Stable protocol coordination diagnostics for the actual session owner. */
import { RPC_CARRIER_HANDSHAKE_FRAME_BYTES } from '../sdk/carrier/constants.js'

/** Session negotiation and physical byte framing share the same initial admission quota. */
export const SessionText = {
  /** Opaque arrivals share three verification slots until authenticated control identity is known. */
  maximumConcurrentVerifications: 3,
  /** Closing keepalive semantic bytes are bounded independently for each physical connection. */
  defaultKeepaliveBytes: 65_536,
  /** One shared close budget covers handlers, native reason and all final physical writes. */
  defaultKeepaliveTimeoutMs: 1000,
  /** Business frames cannot execute before the host accepts both identity and directory. */
  handshakeRequired: 'RPC session handshake is not complete',
  /** A physical source cannot replace its accepted direct peer identity in a later frame. */
  identityMismatch: 'RPC session identity does not match its physical source',
  /** New-profile negotiation admits one deterministic agreement on each connection. */
  handshakeUnexpected: 'RPC session handshake step is unexpected',
  /** A scheduler failure prevented the Session's handshake deadline from being installed. */
  handshakeScheduleFailed: 'RPC handshake scheduling failed',
  /** Default size is the retained native frame ceiling; specific carriers may configure less. */
  defaultMaxFrameBytes: 16_777_216,
  /** Existing host control pings have their own bounded health clock, separate from call features. */
  defaultControlTimeoutMs: 1000,
  /** Silent bootstrap retains the original ten-second startup deadline across every carrier. */
  defaultHandshakeTimeoutMs: 10_000,
  /** Same-name admission retains the existing connect probe deadline. */
  defaultNameProbeTimeoutMs: 10_000,
  /** Common JSON bootstrap has the retained first-message ceiling. */
  handshakeMaxFrameBytes: RPC_CARRIER_HANDSHAKE_FRAME_BYTES
} as const
