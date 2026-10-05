import { RpcCapability } from '../../contract/wire-constants.js'

/** Stable profile version and hello correlation id used by every external peer. */
export const JsonRpcProfile = {
  version: '2.0',
  capability: 'jsonrpc-bridge@1',
  wireError: 'wire-error@1',
  hello: 'migaia.hello',
  describe: 'migaia.describe',
  invoke: 'migaia.invoke',
  cancel: 'migaia.cancel'
} as const

/** Only capabilities with a mapping in this initiator profile may be advertised. */
export const JSONRPC_REQUIRED_CAPABILITIES = [
  JsonRpcProfile.capability,
  RpcCapability.runtimeApi,
  RpcCapability.batch,
  RpcCapability.abort,
  JsonRpcProfile.wireError
] as const
/** Optional metadata capabilities never introduce native control or stream frames. */
export const JSONRPC_ALLOWED_CAPABILITIES: readonly string[] = [
  ...JSONRPC_REQUIRED_CAPABILITIES,
  RpcCapability.deadline,
  RpcCapability.idempotency,
  RpcCapability.trace
]
/** The responder must register all four extension methods before it can become usable. */
export const JSONRPC_REQUIRED_METHODS = [
  JsonRpcProfile.hello,
  JsonRpcProfile.describe,
  JsonRpcProfile.invoke,
  JsonRpcProfile.cancel
] as const

/** Standard JSON-RPC integers classify foreign errors without replacing semantic identities. */
export const JsonRpcErrorNumber = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  business: -32000
} as const
/** Frame budgets include all header bytes and exclude UTF-8 body bytes from the header. */
export const JsonRpcLimit = {
  headerBytes: 1024,
  bodyBytes: 16_777_216,
  handshakeMs: 10_000
} as const
/** Canonical Content-Length framing never uses the native four-byte stream prefix. */
export const JsonRpcHeader = {
  length: 'content-length',
  type: 'content-type',
  end: '\r\n\r\n',
  line: '\r\n',
  prefix: 'Content-Length: '
} as const
