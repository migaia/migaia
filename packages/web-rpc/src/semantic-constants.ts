/**
 * Compatibility discriminants used by the legacy endpoint adapters while their readers are routed
 * through the canonical contract composition boundary.
 *
 * These values remain stable for existing WebRPC peers; new contract endpoints use the
 * runtime-neutral `@migaia/rpc-contract` envelope directly.
 */
export const WebRpcMessageKind = {
  discoveryQuery: 'discovery-query',
  discoveryResponse: 'discovery-response',
  request: 'request',
  response: 'response',
  variation: 'variation',
  chunk: 'chunk'
} as const

/** Stable control variations retained for the legacy adapter boundary. */
export const WebRpcVariation = {
  abort: 'abort',
  ping: 'ping',
  pong: 'pong'
} as const

/** Legacy message discriminant value used by adapter internals. */
export type IWebRpcMessageKind = (typeof WebRpcMessageKind)[keyof typeof WebRpcMessageKind]

/** Legacy variation value used by adapter internals. */
export type IWebRpcVariation = (typeof WebRpcVariation)[keyof typeof WebRpcVariation]
