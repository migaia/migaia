/** Canonical discriminants used on the web-rpc wire. */
export const WebRpcMessageKind = {
  discoveryQuery: 'discovery-query',
  discoveryResponse: 'discovery-response',
  request: 'request',
  response: 'response',
  variation: 'variation',
  chunk: 'chunk'
} as const

export const WebRpcVariation = {
  abort: 'abort',
  ping: 'ping',
  pong: 'pong'
} as const

/** Stable platform labels attached to transports and endpoint diagnostics. */
export const WebRpcPlatform = {
  broadcastChannel: 'BroadcastChannel',
  iframe: 'Iframe',
  memory: 'Memory',
  messagePort: 'MessagePort',
  rtcDataChannel: 'RTCDataChannel',
  webTransport: 'WebTransport',
  worker: 'Worker'
} as const

/** Ownership contract for adapter resources. */
export const WebRpcTransportOwnership = {
  owned: 'owned',
  borrowed: 'borrowed'
} as const

/** Message encoding labels exposed by transport metadata. */
export const WebRpcTransportEncoding = {
  any: 'any',
  string: 'string',
  uint8Array: 'uint8array'
} as const

/** Transport topology labels used to describe peer fan-out. */
export const WebRpcTransportTopology = {
  exclusive: 'exclusive',
  multiplexed: 'multiplexed',
  broadcast: 'broadcast'
} as const

/** Endpoint admission states exposed in discovery metadata. */
export const WebRpcEndpointStatus = { active: 'active' } as const

/** Single-target operation labels used by receiver selection. */
export const WebRpcOperation = {
  send: 'send',
  dispatch: 'dispatch',
  ping: 'ping'
} as const

/** Provider-control kinds used by endpoint resource admission. */
export const WebRpcControlKind = {
  request: 'request',
  dispatch: 'dispatch',
  ping: 'ping',
  discovery: 'discovery'
} as const

/** Discovery candidate registration states. */
export const WebRpcCandidateStatus = {
  active: 'active',
  stale: 'stale',
  unregistered: 'unregistered'
} as const

/** Structured failure kind carried by schema validation diagnostics. */
export const WebRpcContractFailureKind = { schemaValidation: 'schema-validation' } as const

/** Test-only endpoint lifecycle snapshot phases. */
export const WebRpcDebugPhase = { active: 'active', disposed: 'disposed' } as const

/** Hook event names emitted by chunk admission and expiry handling. */
export const WebRpcChunkEvent = {
  rejected: 'chunk.rejected',
  expired: 'chunk.expired'
} as const

export type IWebRpcMessageKind = (typeof WebRpcMessageKind)[keyof typeof WebRpcMessageKind]
export type IWebRpcVariation = (typeof WebRpcVariation)[keyof typeof WebRpcVariation]
export type IWebRpcChunkEvent = (typeof WebRpcChunkEvent)[keyof typeof WebRpcChunkEvent]
export type IWebRpcPlatformValue = (typeof WebRpcPlatform)[keyof typeof WebRpcPlatform]
export type IWebRpcTransportOwnershipValue =
  (typeof WebRpcTransportOwnership)[keyof typeof WebRpcTransportOwnership]
export type IWebRpcTransportEncodingValue =
  (typeof WebRpcTransportEncoding)[keyof typeof WebRpcTransportEncoding]
export type IWebRpcTransportTopologyValue =
  (typeof WebRpcTransportTopology)[keyof typeof WebRpcTransportTopology]
export type IWebRpcOperation = (typeof WebRpcOperation)[keyof typeof WebRpcOperation]
export type IWebRpcControlKind = (typeof WebRpcControlKind)[keyof typeof WebRpcControlKind]
export type IWebRpcCandidateStatus =
  (typeof WebRpcCandidateStatus)[keyof typeof WebRpcCandidateStatus]
