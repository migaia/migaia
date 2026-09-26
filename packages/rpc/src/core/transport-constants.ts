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

/** Endpoint admission state exposed in transport diagnostics. */
export const WebRpcEndpointStatus = { active: 'active' } as const

/** Single-target operation labels used by receiver selection. */
export const WebRpcOperation = {
  send: 'send',
  dispatch: 'dispatch',
  ping: 'ping'
} as const

/** Discovery candidate registration states owned by the transport runtime. */
export const WebRpcCandidateStatus = {
  active: 'active',
  stale: 'stale',
  unregistered: 'unregistered'
} as const

export type IWebRpcPlatformValue = (typeof WebRpcPlatform)[keyof typeof WebRpcPlatform]
export type IWebRpcTransportOwnershipValue =
  (typeof WebRpcTransportOwnership)[keyof typeof WebRpcTransportOwnership]
export type IWebRpcTransportEncodingValue =
  (typeof WebRpcTransportEncoding)[keyof typeof WebRpcTransportEncoding]
export type IWebRpcTransportTopologyValue =
  (typeof WebRpcTransportTopology)[keyof typeof WebRpcTransportTopology]
export type IWebRpcOperation = (typeof WebRpcOperation)[keyof typeof WebRpcOperation]
export type IWebRpcCandidateStatus =
  (typeof WebRpcCandidateStatus)[keyof typeof WebRpcCandidateStatus]
