/** Native installation identity belongs to the actual optional authentication owner. */
export const RpcAuthenticationPluginName = 'rpc-auth'
/** Signed replay framing is independent from carrier and semantic protocol versions. */
export const RpcAuthenticationEnvelope = {
  /** Original object discriminator keeps signing callbacks on the same complete replay binding. */
  kind: 'rpc-authentication-replay',
  /** The original text marker is covered by signing and encryption rather than an unsigned header. */
  prefix: '\u001erpc-authentication-v1:',
  /** Authentication replay wrapper revision is separate from migaia.rpc/2. */
  version: 1,
  /** Allocation fails before the original uint64 counter could wrap and reuse a signed sequence. */
  maximumCounter: 0xffffffffffffffffn
} as const
/** Signed handshake auth carries receiver freshness without adding an RPC handshake step. */
export const RpcAuthenticationHandshake = {
  /** Distinguishes auth-owned freshness metadata from arbitrary configured credentials. */
  kind: 'rpc-authentication-handshake',
  /** This private wrapper is covered by the existing signed envelope transform. */
  version: 1
} as const
/** The original supported transform representation categories remain the complete public domain. */
export const RpcAuthenticationEncoding = {
  any: 'any',
  string: 'string',
  bytes: 'uint8array'
} as const

/** Numeric request-ID retention bounds are independent from signed-envelope counter windows. */
export const RpcAuthenticationReplayPolicy = {
  /** Numeric active and completed correlations share this non-evicting installation bound. */
  maxEntries: 4096,
  /** One numeric-retention peer cannot occupy the entire original replay budget. */
  maxEntriesPerPeer: 1024,
  /** Refused identities keep their original short retry refusal without refreshing timestamps. */
  rejectedTtlMs: 1_000
} as const
