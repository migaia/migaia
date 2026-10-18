export type IRpcSendOptions<Transfer = unknown> = { readonly transfer?: readonly Transfer[] }
import type { IRpcCarrierProbe } from './probe/types.js'
import type {
  IRpcPlatformValue,
  IRpcTransportEncodingValue,
  IRpcTransportOwnershipValue,
  IRpcTransportTopologyValue
} from './transport-constants.js'
export type IRpcTransportEncoding = IRpcTransportEncodingValue
export type IRpcTransportOwnership = IRpcTransportOwnershipValue
export type IRpcInboundMessage<T = unknown> = {
  readonly data: T
  readonly peerId?: string
  readonly origin?: string
  readonly source?: unknown
}
export type IRpcTransport<Message = unknown, Transfer = unknown> = {
  send(message: Message, options?: IRpcSendOptions<Transfer>): void | Promise<void>
  subscribe(listener: (message: IRpcInboundMessage<Message>) => void): () => void
  close?(): void | Promise<void>
  onTransportError?(listener: (error: unknown) => void): () => void
  onListenerError?(listener: (error: unknown) => void): () => void
  /** Optional carrier observation capability; the contract layer never calls this slot. */
  observe?(probe: IRpcCarrierProbe): () => void
  readonly peerId?: string
  readonly origin?: string
  readonly platform: IRpcPlatformValue
  /** Describes whether adapter messages share one peer, many peers, or a broadcast group. */
  readonly topology?: IRpcTransportTopologyValue
  readonly encodedType?: IRpcTransportEncoding
  readonly ownership?: IRpcTransportOwnership
  /** Adapter-owned source proof for multiplexed transports. */
  readonly sourceProof?: (source: unknown, origin?: string) => boolean
  /** True only when the adapter can prove that no further messages can be delivered. */
  readonly closed?: boolean
}
