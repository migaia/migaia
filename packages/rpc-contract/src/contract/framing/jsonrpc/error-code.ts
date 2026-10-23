/**
 * Registry-visible declaration of the bridge protocol source; it never changes with the package
 * name.
 */
export const ERROR_SOURCE = 'rpc.contract.jsonrpc'
/** Dedicated public source separates bridge protocol failures from core and process failures. */
export const JSONRPC_BRIDGE_ERROR_SOURCE = ERROR_SOURCE
/** Public bridge codes describe one profile failure each; native error types stay intact. */
export const JsonRpcBridgeErrorCode = {
  /** Invalid headers, body encoding, JSON or truncated EOF closes this byte connection. */
  frameInvalid: 'JSONRPC_FRAME_INVALID',
  /** A required method, capability or business wire-error extension is absent. */
  extensionMissing: 'JSONRPC_EXTENSION_MISSING',
  /** A profile message or caller option cannot be translated; choose a supported profile. */
  profileInvalid: 'JSONRPC_PROFILE_INVALID',
  /** A contract includes generators; use a native channel for streaming methods. */
  unsupportedMode: 'JSONRPC_UNSUPPORTED_MODE',
  /** The hello deadline expires; the caller may establish a new connection. */
  handshakeTimeout: 'JSONRPC_HANDSHAKE_TIMEOUT'
} as const
/** Stable semantic values used with the dedicated JSON-RPC bridge error source. */
export type IJsonRpcBridgeErrorCode =
  (typeof JsonRpcBridgeErrorCode)[keyof typeof JsonRpcBridgeErrorCode]
