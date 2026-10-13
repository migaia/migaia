import { serializeRpcError } from '@migaia/rpc-contract/errors'
import { decodeRpcDevtoolsRecord } from '../contract/record-codec.js'
import type { IRpcDevtoolsStats } from '../contract/service.js'
import type { IRpcDevtoolsWireEvent } from '../contract/wire.js'
import { RpcDevtoolsErrorCode } from '../error-code.js'
import { identifyDevtoolsError } from '../errors.js'
import { alignTarget, hubHost } from './clock.js'
import { catchUpTarget, releaseTarget, startTargetWatch } from './ingest.js'
import {
  createInteractionIndex,
  indexInteraction,
  queryInteractions,
  unindexInteraction
} from './interactions.js'
import { mergeStats } from './stats.js'
import {
  createHubTarget,
  retainTargetEvent,
  type IHubTarget,
  type IHubTimelineEvent
} from './targets.js'
import { HubErrorText, HubEventName, HubServiceMethod } from './text.js'
import { mergeTimeline } from './timeline.js'
import {
  RpcDevtoolsTargetStatus,
  type IRpcDevtoolsHub,
  type IRpcDevtoolsHubOptions,
  type IRpcDevtoolsTargetClient,
  type IRpcDevtoolsTimelineEvent,
  type IRpcDevtoolsTimelineQuery
} from './types.js'

/** Default per-target retention is the hub R4 bound, independent of each collector's ring. */
const DEFAULT_MAX_EVENTS = 50_000

/** JavaScript array length bounds the registration-time ring allocation. */
const MAX_ARRAY_LENGTH = 4_294_967_295

/** A target status listener observes lifecycle values rather than thrown error codes. */
type IHubStatusListener = (name: string, status: RpcDevtoolsTargetStatus) => void

/** An event listener receives the stored wrapper, including its original wire event reference. */
type IHubEventListener = (event: IRpcDevtoolsTimelineEvent) => void

/** A cleared listener slot preserves dispatch positions during reentrant unsubscribe. */
type IHubListenerSlot<T> = { listener: T | undefined }

/**
 * Aggregate existing service clients and offline records without acquiring transports or Peers.
 * Target registration owns alignment/watch resources; returned queries reuse retained references.
 */
export function createRpcDevtoolsHub(options?: IRpcDevtoolsHubOptions): IRpcDevtoolsHub {
  if (options !== undefined && (typeof options !== 'object' || options === null))
    throw identifyDevtoolsError(
      new TypeError(HubErrorText.invalidOptions),
      RpcDevtoolsErrorCode.invalidOption
    )
  /** Snapshot construction options so later caller mutation cannot change resource ownership. */
  const maxEvents = options?.maxEvents ?? DEFAULT_MAX_EVENTS
  /** An omitted period leaves alignment at registration only. */
  const realignMs = options?.realignMs
  /**
   * The captured callback isolates observation failures from target ingestion and listener
   * dispatch.
   */
  const onError = options?.onError
  if (
    !Number.isSafeInteger(maxEvents) ||
    maxEvents <= 0 ||
    maxEvents > MAX_ARRAY_LENGTH ||
    (realignMs !== undefined && (!Number.isFinite(realignMs) || realignMs <= 0)) ||
    (onError !== undefined && typeof onError !== 'function')
  )
    throw identifyDevtoolsError(
      new TypeError(HubErrorText.invalidOptions),
      RpcDevtoolsErrorCode.invalidOption
    )

  /** Registration order is preserved for cleanup and its original-first aggregate error. */
  const targets = new Map<string, IHubTarget>()
  /** Removed names keep repeated remove idempotent without retaining events or connections. */
  const removed = new Set<string>()
  /** Incremental interaction and trace membership is shared by ingestion, eviction and queries. */
  const interactions = createInteractionIndex()
  /** Slots are allocated on subscription, never while an event is being dispatched. */
  const statusListeners: IHubListenerSlot<IHubStatusListener>[] = []
  /** Independent event slots keep throwing/reentrant listeners from skipping subsequent listeners. */
  const eventListeners: IHubListenerSlot<IHubEventListener>[] = []
  /** Closing immediately rejects new public operations before any asynchronous watch release. */
  let closed = false
  /** Every close call returns this exact completion promise, including reentrant close calls. */
  let closePromise: Promise<void> | undefined

  /** Report original runtime failures; a failing application reporter also stays observable. */
  function report(error: unknown): void {
    if (onError === undefined) {
      hubHost.console.error(error)
      return
    }
    try {
      onError(error)
    } catch (failure) {
      hubHost.console.error(
        new AggregateError([error, failure], HubErrorText.reporter, { cause: error })
      )
    }
  }

  /** Every public operation except repeated close shares one terminal-state entry guard. */
  function assertOpen(): void {
    if (closed)
      throw identifyDevtoolsError(new Error(HubErrorText.closed), RpcDevtoolsErrorCode.closed)
  }

  /** Name ownership is checked before decoding records or beginning any remote alignment. */
  function assertAvailable(name: string): void {
    if (typeof name !== 'string' || name.length === 0)
      throw identifyDevtoolsError(
        new TypeError(HubErrorText.invalidTarget),
        RpcDevtoolsErrorCode.invalidOption
      )
    if (targets.has(name))
      throw identifyDevtoolsError(
        new Error(HubErrorText.duplicate),
        RpcDevtoolsErrorCode.targetDuplicate
      )
  }

  /** Resolve a registered target without inventing state for a name that never existed. */
  function getTarget(name: string): IHubTarget {
    /** A registered target owns every subsequent service request or watch release. */
    const target = targets.get(name)
    if (target === undefined || target.status === RpcDevtoolsTargetStatus.removed)
      throw identifyDevtoolsError(
        new Error(HubErrorText.unknown),
        RpcDevtoolsErrorCode.targetUnknown
      )
    return target
  }

  /** Publish one lifecycle transition while isolating each subscribed callback's original failure. */
  function setStatus(target: IHubTarget, status: RpcDevtoolsTargetStatus): void {
    target.status = status
    if (status === RpcDevtoolsTargetStatus.disconnected && target.interval !== undefined) {
      hubHost.clearInterval(target.interval)
      target.interval = undefined
    }
    /** New subscriptions during dispatch begin with the next transition. */
    const length = statusListeners.length
    for (let i = 0; i < length; i++) {
      /** Unsubscribe clears a slot without shifting the callback currently being dispatched. */
      const listener = statusListeners[i]!.listener
      if (listener === undefined) continue
      try {
        listener(target.name, status)
      } catch (error) {
        report(error)
      }
    }
  }

  /** Ingest once by sequence, maintaining retention and correlation before listener callbacks run. */
  function attachCarrierEvent(
    item: IRpcDevtoolsTimelineEvent,
    identity: IRpcDevtoolsTimelineEvent,
    indexed = true
  ): void {
    if (item.interaction !== undefined || identity.interaction === undefined) return
    /**
     * Only this original stored wrapper changes; its wire event and captured content stay
     * references.
     */
    const linked = item as IHubTimelineEvent
    linked.interaction = identity.interaction
    linked.trace = identity.trace
    if (indexed) indexInteraction(interactions, linked)
  }

  /**
   * Ingest once by sequence; deferred physical stages join only after actual decode reveals
   * identity.
   */
  function accept(target: IHubTarget, event: IRpcDevtoolsWireEvent): void {
    if (!target.active || event.seq <= target.lastSeq) return
    target.lastSeq = event.seq
    /** One wrapper is created at ingest; SC9 keeps the entire wire event and its payload references. */
    const item: IRpcDevtoolsTimelineEvent = {
      target: target.name,
      alignedAt: event.at - target.offset,
      uncertaintyMs: target.uncertaintyMs,
      interaction:
        event.senderId !== undefined && event.messageId !== undefined
          ? `${event.senderId}:${event.messageId}`
          : undefined,
      trace: event.trace,
      event
    }
    /** Ring displacement removes exactly the old stored reference from both incremental indexes. */
    /** The next ring position also owns its fixed pending-link cells. */
    const slot =
      target.count < target.events.length
        ? (target.head + target.count) % target.events.length
        : target.head
    const evicted = retainTargetEvent(target, item)
    if (evicted !== undefined) {
      unindexInteraction(interactions, evicted)
      target.sequences.delete(evicted.event.seq)
    }
    target.sequences.set(event.seq, slot)
    target.carrierHeads[slot] = -1
    target.carrierNext[slot] = -1
    if (event.carrierSeq !== undefined) {
      /** Collector-domain ordinals scope this lookup to the exact same target. */
      const carrierSlot = target.sequences.get(event.carrierSeq)
      if (carrierSlot !== undefined) {
        /** No evicted carrier is reconstructed and no event from another target can be substituted. */
        const carrier = target.events[carrierSlot]!
        if (item.interaction !== undefined) {
          attachCarrierEvent(carrier, item)
          /** Every waiting physical wrapper is indexed exactly once, preserving target/trace counts. */
          let sequence = target.carrierHeads[carrierSlot]!
          target.carrierHeads[carrierSlot] = -1
          while (sequence >= 0) {
            /** Ring retention preserves all newer children while their originating carrier remains. */
            const linkedSlot = target.sequences.get(sequence)
            if (linkedSlot === undefined) break
            attachCarrierEvent(target.events[linkedSlot]!, item)
            sequence = target.carrierNext[linkedSlot]!
            target.carrierNext[linkedSlot] = -1
          }
        } else if (carrier.interaction !== undefined) attachCarrierEvent(item, carrier, false)
        else {
          target.carrierNext[slot] = target.carrierHeads[carrierSlot]!
          target.carrierHeads[carrierSlot] = event.seq
        }
      }
    }
    indexInteraction(interactions, item)
    /** Current dispatch remains valid even when an earlier listener removes this target. */
    const length = eventListeners.length
    for (let i = 0; i < length; i++) {
      /** Slot lifetime is independent of the event target's reentrant removal. */
      const listener = eventListeners[i]!.listener
      if (listener === undefined) continue
      try {
        listener(item)
      } catch (error) {
        report(error)
      }
    }
  }

  /** Detach retained state synchronously so pending reads and reentrant callbacks cannot restore it. */
  function detach(target: IHubTarget): void {
    if (target.status === RpcDevtoolsTargetStatus.removed) return
    target.active = false
    removed.add(target.name)
    for (let i = 0; i < target.count; i++) {
      /** Only this target's current ring members are removed from the shared interaction index. */
      const position = (target.head + i) % target.events.length
      unindexInteraction(interactions, target.events[position]!)
      target.events[position] = undefined
    }
    target.count = 0
    target.head = 0
    target.sequences.clear()
    target.carrierHeads.fill(-1)
    target.carrierNext.fill(-1)
    setStatus(target, RpcDevtoolsTargetStatus.removed)
  }

  /** Optional periodic alignment shares the registration clock owner and permits one job at a time. */
  function startRealignment(target: IHubTarget): void {
    if (realignMs === undefined) return
    target.interval = hubHost.setInterval(() => {
      if (!target.active || target.realigning) return
      target.realigning = true
      void alignTarget(target)
        .catch(report)
        .finally(() => {
          target.realigning = false
        })
    }, realignMs)
  }

  /** Register before describe, then catch up before acquiring the target's single live watch. */
  async function addTarget(name: string, client: IRpcDevtoolsTargetClient): Promise<void> {
    assertOpen()
    assertAvailable(name)
    if (!client || typeof client.request !== 'function' || typeof client.stream !== 'function')
      throw identifyDevtoolsError(
        new TypeError(HubErrorText.invalidTarget),
        RpcDevtoolsErrorCode.invalidOption
      )
    /** The target is visible to reentrant status listeners before its first asynchronous request. */
    const target = createHubTarget(name, maxEvents, client)
    targets.set(name, target)
    removed.delete(name)
    setStatus(target, RpcDevtoolsTargetStatus.connecting)
    /** Target binding is allocated once, rather than creating a callback for each received event. */
    const ingest = (event: IRpcDevtoolsWireEvent): void => accept(target, event)
    try {
      await alignTarget(target)
      if (!target.active) return
      await catchUpTarget(target, ingest)
      if (!target.active) return
      startTargetWatch(target, ingest, report, () => {
        if (target.active) setStatus(target, RpcDevtoolsTargetStatus.disconnected)
      })
      if (!target.active || target.status === RpcDevtoolsTargetStatus.disconnected) return
      startRealignment(target)
      setStatus(target, RpcDevtoolsTargetStatus.connected)
    } catch (error) {
      report(error)
      if (target.active) setStatus(target, RpcDevtoolsTargetStatus.disconnected)
      throw error
    }
  }

  /** Removal invalidates indexes first, then awaits this target's original iterator release. */
  async function removeTarget(name: string): Promise<void> {
    assertOpen()
    if (removed.has(name)) return
    /** Keep the resource owner registered until return settles so reentrant close can join it. */
    const target = getTarget(name)
    /** Cache release before removed listeners can close the hub while this watch is returning. */
    const release = releaseTarget(target)
    detach(target)
    try {
      await release
    } catch (error) {
      report(error)
      throw error
    } finally {
      if (targets.get(name) === target) targets.delete(name)
    }
  }

  /** Decode and convert the complete recording before exposing a read-only offline target. */
  function importRecord(name: string, text: string): void {
    assertOpen()
    assertAvailable(name)
    /** SC9(b): codec output is the owned NDJSON boundary representation, not a copied live event. */
    const record = decodeRpcDevtoolsRecord(text)
    /** Reuse the codec-owned event array; only restored native errors need a wire representation. */
    const events = record.events as IRpcDevtoolsWireEvent[]
    for (let i = 0; i < record.events.length; i++) {
      /** The decoded event retains its content/detail references through any error conversion. */
      const event = record.events[i]!
      if (event.error instanceof Error) {
        /**
         * SC9(b): the service wire boundary requires serialized errors, preserving the entire
         * chain.
         */
        events[i] = {
          ...event,
          error: serializeRpcError(event.error, {
            /** A failed conversion aborts import before target registration and remains visible. */
            report: (failure) => {
              throw failure.error
            }
          })
        }
      }
    }
    /** Offline time uses offset zero and no uncertainty because record v1 carries neither sample. */
    const target = createHubTarget(name, maxEvents)
    targets.set(name, target)
    removed.delete(name)
    setStatus(target, RpcDevtoolsTargetStatus.offline)
    for (let i = 0; i < events.length && target.active; i++) accept(target, events[i]!)
  }

  /** Return status values without exposing mutable target storage or inventing unknown states. */
  function status(
    name?: string
  ): RpcDevtoolsTargetStatus | ReadonlyMap<string, RpcDevtoolsTargetStatus> {
    assertOpen()
    if (name !== undefined)
      return removed.has(name) ? RpcDevtoolsTargetStatus.removed : getTarget(name).status
    /** SC9(b): a public status Map is a boundary projection from private target resource owners. */
    const statuses = new Map<string, RpcDevtoolsTargetStatus>()
    for (const [targetName, target] of targets) statuses.set(targetName, target.status)
    for (const targetName of removed) statuses.set(targetName, RpcDevtoolsTargetStatus.removed)
    return statuses
  }

  /** Validate the public result limit, then k-way merge the retained sequence rings. */
  function timeline(query?: IRpcDevtoolsTimelineQuery): readonly IRpcDevtoolsTimelineEvent[] {
    assertOpen()
    if (query?.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 0))
      throw identifyDevtoolsError(
        new TypeError(HubErrorText.invalidQuery),
        RpcDevtoolsErrorCode.invalidOption
      )
    return mergeTimeline(targets.values(), query)
  }

  /** Forward a named target by identity; aggregate service histograms only when several contribute. */
  async function stats(name?: string): Promise<IRpcDevtoolsStats> {
    assertOpen()
    try {
      if (name !== undefined) {
        /** Offline record v1 has no stats payload; returning empty data does not invent counts. */
        const client = getTarget(name).client
        return client === undefined
          ? mergeStats([])
          : ((await client.request(HubServiceMethod.stats)) as IRpcDevtoolsStats)
      }
      /** Service calls run concurrently and preserve their original result objects for the merger. */
      const pending: Promise<IRpcDevtoolsStats>[] = []
      for (const target of targets.values())
        if (target.status !== RpcDevtoolsTargetStatus.removed && target.client !== undefined)
          pending.push(target.client.request(HubServiceMethod.stats) as Promise<IRpcDevtoolsStats>)
      return mergeStats(await Promise.all(pending))
    } catch (error) {
      report(error)
      throw error
    }
  }

  /** Status subscribers observe lifecycle transitions through the frozen public overload. */
  function on(event: typeof HubEventName.status, listener: IHubStatusListener): () => void
  /** Event subscribers receive retained wrappers rather than per-listener copies. */
  function on(event: typeof HubEventName.event, listener: IHubEventListener): () => void
  /** Store each subscription once; clearing its slot cannot disturb current event dispatch. */
  function on(
    event: typeof HubEventName.status | typeof HubEventName.event,
    listener: IHubStatusListener | IHubEventListener
  ): () => void {
    assertOpen()
    if (event === HubEventName.status) {
      /** This slot owns the status callback until unsubscribe or close. */
      const slot: IHubListenerSlot<IHubStatusListener> = {
        listener: listener as IHubStatusListener
      }
      statusListeners.push(slot)
      return () => {
        slot.listener = undefined
      }
    }
    /** This slot owns the event callback until unsubscribe or close. */
    const slot: IHubListenerSlot<IHubEventListener> = { listener: listener as IHubEventListener }
    eventListeners.push(slot)
    return () => {
      slot.listener = undefined
    }
  }

  /** Invalidate all targets synchronously, release watches concurrently and report ordered failures. */
  function close(): Promise<void> {
    if (closePromise !== undefined) return closePromise
    closed = true
    /** Cache completion before removed listeners can reenter close during synchronous detachment. */
    const completion = Promise.withResolvers<void>()
    closePromise = completion.promise
    for (const target of targets.values()) target.active = false
    /** Release results retain registration order even if later targets finish first. */
    const releases: Promise<void>[] = []
    for (const target of targets.values()) {
      releases.push(releaseTarget(target))
      detach(target)
    }
    void Promise.allSettled(releases).then((results) => {
      /** Every failed return remains reachable and first-error order follows target registration. */
      const failures: unknown[] = []
      for (const result of results) if (result.status === 'rejected') failures.push(result.reason)
      if (failures.length > 0)
        report(new AggregateError(failures, HubErrorText.release, { cause: failures[0] }))
      for (const slot of statusListeners) slot.listener = undefined
      for (const slot of eventListeners) slot.listener = undefined
      statusListeners.length = 0
      eventListeners.length = 0
      targets.clear()
      removed.clear()
      completion.resolve()
    })
    return closePromise
  }

  return {
    addTarget,
    removeTarget,
    importRecord,
    status,
    timeline,
    /** Correlation is maintained on ingest/eviction; this query never rescans the timeline. */
    interactions(trace) {
      assertOpen()
      return queryInteractions(interactions, trace)
    },
    stats,
    on,
    close
  }
}

export * from './types.js'
