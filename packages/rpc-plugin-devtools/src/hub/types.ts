import type { IRpcDevtoolsStats } from '../contract/service.js'
import type { IRpcDevtoolsWireEvent } from '../contract/wire.js'

/** Target states are events/return values, never thrown error codes. */
export const RpcDevtoolsTargetStatus = {
  /** Live target clock/history/watch setup is still running. */
  connecting: 'connecting',
  /** Live setup completed and its watch remains active. */
  connected: 'connected',
  /** Setup or watch ended/failed; retained data remains available until removal. */
  disconnected: 'disconnected',
  /** Decoded recording with no live client or remote clock sample. */
  offline: 'offline',
  /** Retention/indexes detached; repeated removal is harmless. */
  removed: 'removed'
} as const

/** Same-name union shares the status vocabulary's one canonical declaration. */
export type RpcDevtoolsTargetStatus = keyof typeof RpcDevtoolsTargetStatus

/** Users supply an already connected client; the hub creates no transports or Peers. */
export type IRpcDevtoolsTargetClient = Readonly<{
  /** Bare describe/query/stats service names; callers adapt any Peer namespace themselves. */
  request(method: string, payload?: unknown): Promise<unknown>
  /** Original watch iterable; the hub owns returning this watch, not closing the client. */
  stream(method: string, payload?: unknown): AsyncIterable<unknown>
}>

/** Time alignment belongs to the hub; the contained service event remains unchanged. */
export type IRpcDevtoolsTimelineEvent = Readonly<{
  /** Local registration name, distinct from endpoint identity. */
  target: string
  /** Hub-clock event time; periodic realignment can update this same wrapper. */
  alignedAt: number
  /** Half the selected sample's RTT, undefined for an offline recording. */
  uncertaintyMs: number | undefined
  /** Supported observed correlation key, absent without valid correlation identity. */
  interaction?: string
  /** Explicit trace from this event or a supported same-target carrier link. */
  trace?: string
  /** Original wire event reference; alignment does not rewrite it. */
  event: IRpcDevtoolsWireEvent
}>

/** Correlation uses explicit trace and sender/message identity, without synthesizing missing sides. */
export type IRpcDevtoolsInteraction = Readonly<{
  /** Observed sender/message correlation key, not an inferred missing event. */
  key: string
  /** Explicit trace when observed. */
  trace?: string
  /** Observed method path when available. */
  method?: string
  /** Missing caller/provider business role, not merely a single target name. */
  oneSided: boolean
  /** Targets currently contributing retained members. */
  targets: readonly string[]
  /** Stored wrapper references; eviction/removal changes later query membership. */
  events: readonly IRpcDevtoolsTimelineEvent[]
}>

/** Timeline filters select retained target events after alignment. */
export type IRpcDevtoolsTimelineQuery = Readonly<{
  /** Optional local target names; omission selects all retained targets. */
  targets?: readonly string[]
  /** Optional retained stage names. */
  stages?: readonly string[]
  /** Optional exact trace. */
  trace?: string
  /** Optional exact method path. */
  method?: string
  /** Inclusive lower aligned-time bound in monotonic milliseconds; omitted is unbounded. */
  from?: number
  /** Inclusive upper aligned-time bound; omitted is unbounded. */
  to?: number
  /** Default unlimited; nonnegative safe integer, with 0 returning no events. */
  limit?: number
}>

/** Bound per-target retention and optionally refresh clock estimates without creating connections. */
export type IRpcDevtoolsHubOptions = Readonly<{
  /** Per-target capacity, default 50000; positive safe integer within JavaScript array limits. */
  maxEvents?: number
  /** Optional positive finite millisecond period; omission aligns only at registration. */
  realignMs?: number
  /** Optional synchronous sink; defaults to console.error, including close-release diagnostics. */
  onError?(error: unknown): void
}>

/** Aggregate borrowed clients and records, owning only watches, timers and retained indexes. */
export type IRpcDevtoolsHub = Readonly<{
  /**
   * Unique nonempty name; align, activate watch and catch up history. Setup errors report and
   * reject.
   */
  addTarget(name: string, client: IRpcDevtoolsTargetClient): Promise<void>
  /** Detach first, then await this watch return; release errors report and reject unchanged. */
  removeTarget(name: string): Promise<void>
  /** Decode before publishing an offline target, with no live client or timer. */
  importRecord(name: string, text: string): void
  /** One status or a new status Map; unknown names throw TARGET_UNKNOWN. */
  status(name?: string): RpcDevtoolsTargetStatus | ReadonlyMap<string, RpcDevtoolsTargetStatus>
  /** Stored wrappers sorted by aligned time, target and sequence, without nested cloning. */
  timeline(query?: IRpcDevtoolsTimelineQuery): readonly IRpcDevtoolsTimelineEvent[]
  /** Maintained correlation membership; missing sides are not synthesized. */
  interactions(trace?: string): readonly IRpcDevtoolsInteraction[]
  /** Named live result by identity or summed histograms; offline targets add no invented statistics. */
  stats(name?: string): Promise<IRpcDevtoolsStats>
  /** Subscribe to later transitions; the disposer releases only this callback. */
  on(event: 'status', listener: (name: string, status: RpcDevtoolsTargetStatus) => void): () => void
  /**
   * Subscribe to stored wrappers; synchronous failures report without skipping subsequent
   * listeners.
   */
  on(event: 'event', listener: (event: IRpcDevtoolsTimelineEvent) => void): () => void
  /**
   * Stop new work now; one Promise joins all watch returns, reports release errors and resolves.
   * Clients stay borrowed.
   */
  close(): Promise<void>
}>
