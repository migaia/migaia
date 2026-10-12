import type { IRpcDevtoolsStats } from '../contract/service.js'
import type { IRpcDevtoolsWireEvent } from '../contract/wire.js'

/** Target states are events/return values, never thrown error codes (hub R1 and §5). */
export const RpcDevtoolsTargetStatus = {
  connecting: 'connecting',
  connected: 'connected',
  disconnected: 'disconnected',
  offline: 'offline',
  removed: 'removed'
} as const

/** Same-name union shares the status vocabulary's one canonical declaration. */
export type RpcDevtoolsTargetStatus = keyof typeof RpcDevtoolsTargetStatus

/** Users supply an already connected client; the hub creates no transports or Peers. */
export type IRpcDevtoolsTargetClient = Readonly<{
  request(method: string, payload?: unknown): Promise<unknown>
  stream(method: string, payload?: unknown): AsyncIterable<unknown>
}>

/** Time alignment belongs to the hub; the contained service event remains unchanged. */
export type IRpcDevtoolsTimelineEvent = Readonly<{
  target: string
  alignedAt: number
  uncertaintyMs: number | undefined
  interaction?: string
  trace?: string
  event: IRpcDevtoolsWireEvent
}>

/** Correlation uses explicit trace and sender/message identity, without synthesizing missing sides. */
export type IRpcDevtoolsInteraction = Readonly<{
  key: string
  trace?: string
  method?: string
  oneSided: boolean
  targets: readonly string[]
  events: readonly IRpcDevtoolsTimelineEvent[]
}>

/** Timeline filters select retained target events after alignment. */
export type IRpcDevtoolsTimelineQuery = Readonly<{
  targets?: readonly string[]
  stages?: readonly string[]
  trace?: string
  method?: string
  from?: number
  to?: number
  limit?: number
}>

/** Options preserve the public hub §4 realignMs spelling; implementation belongs to layer 2. */
export type IRpcDevtoolsHubOptions = Readonly<{
  maxEvents?: number
  realignMs?: number
  onError?(error: unknown): void
}>

/** Target lifetime, indexing and watch management are implemented by the hub child. */
export type IRpcDevtoolsHub = Readonly<{
  addTarget(name: string, client: IRpcDevtoolsTargetClient): Promise<void>
  removeTarget(name: string): Promise<void>
  importRecord(name: string, text: string): void
  status(name?: string): RpcDevtoolsTargetStatus | ReadonlyMap<string, RpcDevtoolsTargetStatus>
  timeline(query?: IRpcDevtoolsTimelineQuery): readonly IRpcDevtoolsTimelineEvent[]
  interactions(trace?: string): readonly IRpcDevtoolsInteraction[]
  stats(name?: string): Promise<IRpcDevtoolsStats>
  on(event: 'status', listener: (name: string, status: RpcDevtoolsTargetStatus) => void): () => void
  on(event: 'event', listener: (event: IRpcDevtoolsTimelineEvent) => void): () => void
  close(): Promise<void>
}>
