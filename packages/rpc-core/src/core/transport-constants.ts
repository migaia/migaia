/** Stable platform labels attached to transports and endpoint diagnostics. */
export const RpcPlatform = {
  /** Same-origin broadcast carrier. */ broadcastChannel: 'BroadcastChannel',
  /** Window/frame message carrier. */ iframe: 'Iframe',
  /** Same-process reference carrier. */ memory: 'Memory',
  /** MessagePort carrier. */ messagePort: 'MessagePort',
  /** Process IPC or byte carrier. */ process: 'Process',
  /** RTC data-channel carrier. */ rtcDataChannel: 'RTCDataChannel',
  /** WebTransport carrier. */ webTransport: 'WebTransport',
  /** Worker messaging carrier. */ worker: 'Worker'
} as const

/** Ownership contract for adapter resources. */
export const RpcTransportOwnership = {
  /** Endpoint cleanup may close the physical adapter. */ owned: 'owned',
  /** Endpoint cleanup detaches its subscriptions and leaves physical close to the caller. */ borrowed:
    'borrowed'
} as const

/** Message encoding labels exposed by transport metadata. */
export const RpcTransportEncoding = {
  /** No single primitive frame representation is declared. */ any: 'any',
  /** Physical frames are text. */ string: 'string',
  /** Physical frames are Uint8Array bytes. */ uint8Array: 'uint8array'
} as const

/** Transport topology labels used to describe peer fan-out. */
export const RpcTransportTopology = {
  /** The physical binding selects one peer. */ exclusive: 'exclusive',
  /** One carrier can deliver distinguishable direct sources. */ multiplexed: 'multiplexed',
  /** One send can reach a group of listeners. */ broadcast: 'broadcast'
} as const

/** Endpoint admission state exposed in transport diagnostics. */
export const RpcEndpointStatus = {
  /** Endpoint is accepting operations. */ active: 'active'
} as const

/** Single-target operation labels used by receiver selection. */
export const RpcOperation = {
  /** Select a receiver for a result-bearing request. */ send: 'send',
  /** Select a receiver for a notification. */ dispatch: 'dispatch',
  /** Select a receiver for a liveness request. */ ping: 'ping'
} as const

/** Discovery candidate registration states owned by the transport runtime. */
export const RpcCandidateStatus = {
  /** Receiver remains usable by the registry. */ active: 'active',
  /** Receiver has an outdated observation or failed liveness. */ stale: 'stale',
  /** Receiver has been explicitly retired. */ unregistered: 'unregistered'
} as const

/** Stable physical platform label from RpcPlatform. */
export type IRpcPlatformValue = (typeof RpcPlatform)[keyof typeof RpcPlatform]
/** Owned or borrowed adapter cleanup responsibility. */
export type IRpcTransportOwnershipValue =
  (typeof RpcTransportOwnership)[keyof typeof RpcTransportOwnership]
/** Any, string or uint8array frame representation. */
export type IRpcTransportEncodingValue =
  (typeof RpcTransportEncoding)[keyof typeof RpcTransportEncoding]
/** Exclusive, multiplexed or broadcast source topology. */
export type IRpcTransportTopologyValue =
  (typeof RpcTransportTopology)[keyof typeof RpcTransportTopology]
/** Receiver-selection operation label. */
export type IRpcOperation = (typeof RpcOperation)[keyof typeof RpcOperation]
/** Active, stale or unregistered receiver registry state. */
export type IRpcCandidateStatus = (typeof RpcCandidateStatus)[keyof typeof RpcCandidateStatus]
