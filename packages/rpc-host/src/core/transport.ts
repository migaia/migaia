/** Physical send controls; transferring backing resources is adapter-specific, not a deep copy. */
export type IRpcSendOptions<Transfer = unknown> = {
  /** The canonical sender's selected destination survives opaque protection on routed carriers. */
  readonly targetId?: string
  /** Resources whose ownership the physical sender should transfer in the supplied order. */
  readonly transfer?: readonly Transfer[]
}
import type { IRpcCarrierProbe } from './probe/types.js'
import type {
  IRpcPlatformValue,
  IRpcTransportEncodingValue,
  IRpcTransportOwnershipValue,
  IRpcTransportTopologyValue
} from './transport-constants.js'
/** Wire representation accepted by this physical transport, when declared. */
export type IRpcTransportEncoding = IRpcTransportEncodingValue
/** Whether endpoint disposal closes the adapter or only detaches its subscriptions. */
export type IRpcTransportOwnership = IRpcTransportOwnershipValue
/** One adapter delivery; identity metadata describes the actual direct physical source. */
export type IRpcInboundMessage<T = unknown> = {
  /** Frame value delivered to the selected framer. */
  readonly data: T
  /** Direct peer address, when the adapter can establish one. */
  readonly peerId?: string
  /** Native origin, when supplied by the carrier. */
  readonly origin?: string
  /** Native source object used only by the adapter's source verification. */
  readonly source?: unknown
}
/**
 * Physical I/O supplied to an endpoint. Core owns its listeners and logical operations; borrowed
 * adapters stay open on endpoint disposal. Omitted ownership permits Core to invoke close.
 */
export type IRpcTransport<Message = unknown, Transfer = unknown> = {
  /** Send one selected frame; rejection reports physical failure, not whether the peer executed it. */
  send(message: Message, options?: IRpcSendOptions<Transfer>): void | Promise<void>
  /** Attach a receive listener and return the operation that detaches that registration. */
  subscribe(listener: (message: IRpcInboundMessage<Message>) => void): () => void
  /** Retire adapter-owned I/O; Core calls this on disposal unless ownership is borrowed. */
  close?(): void | Promise<void>
  /** Observe physical failures so Core can settle affected pending operations. */
  onTransportError?(listener: (error: unknown) => void): () => void
  /** Observe failures from delivery/observation listeners without treating them as peer replies. */
  onListenerError?(listener: (error: unknown) => void): () => void
  /** Optional carrier observation capability; the contract layer never calls this slot. */
  observe?(probe: IRpcCarrierProbe): () => void
  /** Known direct peer identity; omission leaves selection to connect/discovery policy. */
  readonly peerId?: string
  /** Expected native origin used by the built-in connection verifier. */
  readonly origin?: string
  /** Stable carrier label for verification policy and diagnostics. */
  readonly platform: IRpcPlatformValue
  /** Describes whether adapter messages share one peer, many peers, or a broadcast group. */
  readonly topology?: IRpcTransportTopologyValue
  /** Declared frame representation; omission leaves the adapter representation unrestricted. */
  readonly encodedType?: IRpcTransportEncoding
  /** Borrowed skips physical close; owned or omitted delegates close to endpoint cleanup. */
  readonly ownership?: IRpcTransportOwnership
  /** Adapter-owned source proof for multiplexed transports. */
  readonly sourceProof?: (source: unknown, origin?: string) => boolean
  /** True only when the adapter can prove that no further messages can be delivered. */
  readonly closed?: boolean
}
