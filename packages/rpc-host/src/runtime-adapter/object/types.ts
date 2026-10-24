import type { IRpcHandshakeOffer } from '@migaia/rpc-contract'
import type { IRpcInboundMessage, IRpcSendOptions } from '../../core/transport.js'
import type { IRuntimePeerSourceResult } from '../../remote/runtime-api/peer.js'
import type { IRuntimeByteConnection, IRuntimeConnectionOptions } from '../byte/types.js'

/**
 * Held object I/O retains its physical exchange, text/object views and one terminal lifetime. Core
 * reads the actual handshake reply through exchange; activate receives Core's result.
 */
export type IRuntimeObjectIO = Readonly<{
  /** The JSON-RPC physical owner retains observation and its own disposer. */
  observe?: import('../../core/transport.js').IRpcTransport['observe']
  exchange(hello: string): Promise<string>
  activate(capabilities: readonly string[]): void
  writeText(value: unknown, options?: IRpcSendOptions): void | Promise<void>
  writeObject(value: unknown, options?: IRpcSendOptions): void | Promise<void>
  subscribeText(listener: (message: IRpcInboundMessage) => void): () => void
  subscribeObject(listener: (message: IRpcInboundMessage) => void): () => void
  onTransportError(listener: (error: unknown) => void): () => void
  /** Closing observers run before terminal subscribers, preserving private-port revocation. */
  onClosing(listener: () => void): () => void
  close(reason?: unknown): Promise<void>
  assertOpen(): void
  readonly closed: boolean
}>

/** The constructed channel exposes its actual log and cleanup operations, never trust writers. */
export type IRuntimeObjectChannel = IRuntimePeerSourceResult &
  Pick<IRuntimeByteConnection, 'log' | 'ownClose'>

/**
 * Cold preparation preserves local offer reads before I/O; negotiation reads the actual reply. Open
 * constructs the final transport from the internally retained agreement exactly once.
 */
export type IRuntimeObjectConnection = Readonly<{
  /** Capture the local proposal before negotiation performs physical I/O. */
  prepare(offer: IRpcHandshakeOffer): void
  /** Exchange the actual handshake reply and retain the accepted agreement. */
  negotiate(): Promise<void>
  /** Construct the final channel from the retained agreement and supplied connection controls. */
  open(options: IRuntimeConnectionOptions): IRuntimeObjectChannel
  /** Retire this original physical connection and share its terminal cleanup. */
  close(reason?: unknown): Promise<void>
}>
