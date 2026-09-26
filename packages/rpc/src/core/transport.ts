export type IWebRpcSendOptions<Transfer = unknown> = { readonly transfer?: readonly Transfer[] }
import type {
  IWebRpcPlatformValue,
  IWebRpcTransportEncodingValue,
  IWebRpcTransportOwnershipValue,
  IWebRpcTransportTopologyValue
} from './transport-constants.js'
export type IWebRpcTransportTopology = IWebRpcTransportTopologyValue
export type IWebRpcTransportEncoding = IWebRpcTransportEncodingValue
export type IWebRpcTransportOwnership = IWebRpcTransportOwnershipValue
export type IWebRpcInboundMessage<T = unknown> = {
  readonly data: T
  readonly peerId?: string
  readonly origin?: string
  readonly source?: unknown
}
export type IWebRpcTransport<Message = unknown, Transfer = unknown> = {
  send(message: Message, options?: IWebRpcSendOptions<Transfer>): void | Promise<void>
  subscribe(listener: (message: IWebRpcInboundMessage<Message>) => void): () => void
  close?(): void | Promise<void>
  onTransportError?(listener: (error: unknown) => void): () => void
  onListenerError?(listener: (error: unknown) => void): () => void
  readonly peerId?: string
  readonly origin?: string
  readonly platform: IWebRpcPlatformValue
  /** Describes whether adapter messages share one peer, many peers, or a broadcast group. */
  readonly topology?: IWebRpcTransportTopology
  readonly encodedType?: IWebRpcTransportEncoding
  readonly ownership?: IWebRpcTransportOwnership
  /** Adapter-owned source proof for multiplexed transports. */
  readonly sourceProof?: (source: unknown, origin?: string) => boolean
  /** True only when the adapter can prove that no further messages can be delivered. */
  readonly closed?: boolean
}
