/** Stable public diagnostic text omits untrusted frame bodies and authentication material. */
export const JsonRpcBridgeErrorText = {
  frameInvalid: 'Invalid JSON-RPC Content-Length frame.',
  extensionMissing: 'Required JSON-RPC bridge extension is missing.',
  profileInvalid: 'Invalid JSON-RPC bridge profile.',
  unsupportedMode: 'JSON-RPC bridge does not support streaming methods.',
  handshakeTimeout: 'JSON-RPC bridge handshake timed out.'
} as const
