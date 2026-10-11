/**
 * Core binds actual held byte I/O, negotiates the foreign-language JSON-RPC profile and creates its
 * exact gated channel. Internal object ports and capability registrations are never exposed.
 */
export { createJsonRpcAdapterChannel } from './adapter-owned/jsonrpc/index.js'
export type { IJsonRpcBridgeOptions } from './adapter-owned/jsonrpc/handshake.js'
