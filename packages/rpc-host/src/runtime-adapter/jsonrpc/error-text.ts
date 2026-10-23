/**
 * The JSON-RPC adapter operations own private non-reflecting presentation for their existing
 * failures.
 */
export const JsonRpcBridgeErrorText = {
  /** Malformed Content-Length framing or body decoding keeps its original fixed diagnostic. */
  frameInvalid: 'Invalid JSON-RPC Content-Length frame.',
  /** A peer lacks a required negotiated extension; inspect its public source/code instead. */
  extensionMissing: 'Required JSON-RPC bridge extension is missing.',
  /** Local or received profile grammar fails before unsupported data can be dispatched. */
  profileInvalid: 'Invalid JSON-RPC bridge profile.',
  /** Streaming declarations remain outside this JSON-RPC bridge profile. */
  unsupportedMode: 'JSON-RPC bridge does not support streaming methods.',
  /** The owned hello exchange expires before publication of the actual channel. */
  handshakeTimeout: 'JSON-RPC bridge handshake timed out.'
} as const
