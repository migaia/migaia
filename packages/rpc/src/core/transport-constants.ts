/** Stable platform labels attached to transports and endpoint diagnostics. */
export const RpcPlatform = {
  broadcastChannel: 'BroadcastChannel',
  iframe: 'Iframe',
  memory: 'Memory',
  messagePort: 'MessagePort',
  process: 'Process',
  rtcDataChannel: 'RTCDataChannel',
  webTransport: 'WebTransport',
  worker: 'Worker'
} as const

/** Ownership contract for adapter resources. */
export const RpcTransportOwnership = {
  owned: 'owned',
  borrowed: 'borrowed'
} as const

/** Message encoding labels exposed by transport metadata. */
export const RpcTransportEncoding = {
  any: 'any',
  string: 'string',
  uint8Array: 'uint8array'
} as const

/** Transport topology labels used to describe peer fan-out. */
export const RpcTransportTopology = {
  exclusive: 'exclusive',
  multiplexed: 'multiplexed',
  broadcast: 'broadcast'
} as const

/** Endpoint admission state exposed in transport diagnostics. */
export const RpcEndpointStatus = { active: 'active' } as const

/** Single-target operation labels used by receiver selection. */
export const RpcOperation = {
  send: 'send',
  dispatch: 'dispatch',
  ping: 'ping'
} as const

/** Discovery candidate registration states owned by the transport runtime. */
export const RpcCandidateStatus = {
  active: 'active',
  stale: 'stale',
  unregistered: 'unregistered'
} as const

export type IRpcPlatformValue = (typeof RpcPlatform)[keyof typeof RpcPlatform]
export type IRpcTransportOwnershipValue =
  (typeof RpcTransportOwnership)[keyof typeof RpcTransportOwnership]
export type IRpcTransportEncodingValue =
  (typeof RpcTransportEncoding)[keyof typeof RpcTransportEncoding]
export type IRpcTransportTopologyValue =
  (typeof RpcTransportTopology)[keyof typeof RpcTransportTopology]
export type IRpcOperation = (typeof RpcOperation)[keyof typeof RpcOperation]
export type IRpcCandidateStatus = (typeof RpcCandidateStatus)[keyof typeof RpcCandidateStatus]
