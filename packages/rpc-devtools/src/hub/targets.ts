import type { IRpcDevtoolsWatchBatch } from '../contract/service.js'
import {
  RpcDevtoolsTargetStatus,
  type IRpcDevtoolsTargetClient,
  type IRpcDevtoolsTimelineEvent
} from './types.js'

/** Only the hub may realign its once-created timeline wrapper; public consumers see readonly fields. */
export type IHubTimelineEvent = {
  -readonly [K in keyof IRpcDevtoolsTimelineEvent]: IRpcDevtoolsTimelineEvent[K]
}

/** One target owns a bounded ring, the watch it acquired and its current clock estimate. */
export type IHubTarget = {
  name: string
  client: IRpcDevtoolsTargetClient | undefined
  status: RpcDevtoolsTargetStatus
  active: boolean
  events: (IRpcDevtoolsTimelineEvent | undefined)[]
  head: number
  count: number
  evicted: number
  lastSeq: number
  offset: number
  uncertaintyMs: number | undefined
  iterator: AsyncIterator<IRpcDevtoolsWatchBatch> | undefined
  interval: unknown
  realigning: boolean
  release: Promise<void> | undefined
}

/** Allocate storage at target registration, before any event is received. */
export function createHubTarget(
  name: string,
  maxEvents: number,
  client?: IRpcDevtoolsTargetClient
): IHubTarget {
  /** Reserve ring positions at registration; sparse slots acquire stored wrappers only at ingestion. */
  const events: (IRpcDevtoolsTimelineEvent | undefined)[] = []
  events.length = maxEvents
  return {
    name,
    client,
    status: client ? RpcDevtoolsTargetStatus.connecting : RpcDevtoolsTargetStatus.offline,
    active: true,
    events,
    head: 0,
    count: 0,
    evicted: 0,
    lastSeq: -Infinity,
    offset: 0,
    uncertaintyMs: undefined,
    iterator: undefined,
    interval: undefined,
    realigning: false,
    release: undefined
  }
}

/** Retain the original wrapper in O(1), returning the displaced reference for index removal. */
export function retainTargetEvent(
  target: IHubTarget,
  event: IRpcDevtoolsTimelineEvent
): IRpcDevtoolsTimelineEvent | undefined {
  if (target.count < target.events.length) {
    target.events[(target.head + target.count) % target.events.length] = event
    target.count++
    return undefined
  }
  /** The ring head is both the oldest entry and the next overwritten slot. */
  const evicted = target.events[target.head]
  target.events[target.head] = event
  target.head = (target.head + 1) % target.events.length
  target.evicted++
  return evicted
}
