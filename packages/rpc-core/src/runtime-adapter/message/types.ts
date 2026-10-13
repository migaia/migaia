import type { IAbortSignal } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import type { IRuntimePeerSourceResult, IRuntimePeerSourceContext } from '../../remote/index.js'
import type { INodeMessagePortLike } from '../../core/adapters/message-port.js'

/** Raw EventEmitter messaging optionally supplies its actual reader count and close observation. */
export type IAdapterEventEmitterMessagePort = INodeMessagePortLike &
  Readonly<{
    listenerCount?(event: 'message'): number
    once?(event: 'close', listener: () => void): unknown
  }>

/** Raw EventTarget messaging borrows lifecycle from the held runtime resource. */
export type IAdapterEventTargetMessagePort = Readonly<{
  /** Forward the existing physical carrier observer through the raw Browser Peer resource. */
  observe?: import('../../core/transport.js').IRpcTransport['observe']
  postMessage(message: unknown, transfer?: readonly unknown[]): void
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  /** Physical adapters may retain their native terminal error object through this raw observer. */
  onError?(listener: (error: unknown) => void): () => void
}>

/** Actual launch completion remains separate from requesting native termination. */
export type IAdapterLaunchHandle = Readonly<{
  exited: PromiseLike<unknown>
  terminate(): void
  /** The held launcher supplied this raw initial message to the native runtime. */
  initialMessage?: unknown
  /** The actual launcher publishes an observed native failure before eventual exit. */
  failed?: PromiseLike<unknown>
}>

/** A held native initial-message read keeps undecoded launch data at the resource boundary. */
export type IAdapterInitialMessageResource = Readonly<{
  read(): unknown
  /** Outbound launch input is a local proposal; only inbound input can supply a peer offer. */
  direction: 'inbound' | 'outbound'
}>

/** Static admission can only disable entries from the fixed canonical profile. */
export type IAdapterStaticMessageOptions = Readonly<{
  peerId: string
  scheduler: IScheduler
  enabled?: readonly string[]
}>

/** Local proposals configure this new channel; received control I/O determines accepted capability. */
export type IAdapterMessageOpenOptions = Readonly<{
  peerId: string
  scheduler: IScheduler
  offer: readonly string[]
  control: IRpcMessageCapabilityControl
  signal?: IAbortSignal
  timeoutMs?: number
  bootstrap?: IAdapterInitialMessageResource
}>

/** A held resource constructs its own complete channel, never signs an external transport. */
export type IAdapterMessageResource = Readonly<{
  /** Exchange existing initial records and learn the remote address only from this held raw I/O. */
  exchangeIdentity(context: IRuntimePeerSourceContext, signal?: IAbortSignal): Promise<string>
  receiveInitial(initial?: IAdapterInitialMessageResource, bounded?: true): Promise<unknown>
  prepareControl(
    offer: readonly string[],
    bootstrap?: IAdapterInitialMessageResource
  ): Promise<readonly string[]>
  openStatic(options: IAdapterStaticMessageOptions): IRuntimePeerSourceResult
  open(options: IAdapterMessageOpenOptions): Promise<IRuntimePeerSourceResult>
  close(): Promise<void>
}>
