/** Stable public diagnostic text omits untrusted frame bodies and authentication material. */
export const JsonRpcBridgeErrorText = {
  /** Malformed Content-Length framing or body decoding uses this non-reflecting diagnostic. */
  frameInvalid: 'Invalid JSON-RPC Content-Length frame.',
  /** A peer lacks a required negotiated extension; callers may select a compatible peer. */
  extensionMissing: 'Required JSON-RPC bridge extension is missing.',
  /** Local or received profile grammar fails before unsupported data can be dispatched. */
  profileInvalid: 'Invalid JSON-RPC bridge profile.',
  /** Streaming declarations are outside this JSON-RPC bridge profile. */
  unsupportedMode: 'JSON-RPC bridge does not support streaming methods.',
  /** The owned hello exchange exceeds its original deadline before publication. */
  handshakeTimeout: 'JSON-RPC bridge handshake timed out.'
} as const
