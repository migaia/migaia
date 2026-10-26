/** Identify Auth independently from other optional native plugins. */
export const RpcAuthenticationPluginName = 'rpc-auth'
/** Signed replay framing is independent from carrier and semantic protocol versions. */
export const RpcAuthenticationEnvelope = {
  /** Identify the complete replay binding passed to signing callbacks. */
  kind: 'rpc-authentication-replay',
  /** Protect the text marker inside the signed and encrypted payload. */
  prefix: '\u001erpc-authentication-v1:',
  /** Authentication replay wrapper revision is separate from migaia.rpc/2. */
  version: 1,
  /** Fail before uint64 wrap could reuse a signed sequence. */
  maximumCounter: 0xffffffffffffffffn
} as const
/** Signed handshake auth carries receiver freshness without adding an RPC handshake step. */
export const RpcAuthenticationHandshake = {
  /** Distinguishes auth-owned freshness metadata from arbitrary configured credentials. */
  kind: 'rpc-authentication-handshake',
  /** This private wrapper is covered by the existing signed envelope transform. */
  version: 1
} as const
/** Keep callback encoding choices independent from carrier representations. */
export const RpcAuthenticationEncoding = {
  any: 'any',
  string: 'string',
  bytes: 'uint8array'
} as const

/** Numeric request-ID retention bounds are independent from signed-envelope counter windows. */
export const RpcAuthenticationReplayPolicy = {
  /** Numeric active and completed correlations share this non-evicting installation bound. */
  maxEntries: 4096,
  /** Prevent one peer from occupying the entire numeric replay budget. */
  maxEntriesPerPeer: 1024,
  /** Keep retries refused briefly without extending their expiry. */
  rejectedTtlMs: 1_000
} as const
