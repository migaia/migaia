import {
  RpcProbeDirection,
  RpcProbeDirectionName,
  RpcProbeKind,
  RpcProbeKindName
} from '@migaia/rpc-core/probe'
import type { IRpcDevtoolsInteraction, IRpcDevtoolsTimelineEvent } from './types.js'

/** Public interaction objects are created once and project incrementally maintained membership. */
type IInteractionView = Omit<
  { -readonly [K in keyof IRpcDevtoolsInteraction]: IRpcDevtoolsInteraction[K] },
  'events' | 'targets'
> & { events: IRpcDevtoolsTimelineEvent[]; targets: string[] }

/** Identity sets allow constant-time ring eviction without searching an interaction's members. */
type IInteractionState = {
  view: IInteractionView
  members: Set<IRpcDevtoolsTimelineEvent>
  targets: Map<string, number>
  traces: Map<string, number>
  outbound: number
  inbound: number
  dirty: boolean
}

/** One hub owns interaction membership and the index of explicitly observed trace keys. */
export type IHubInteractionIndex = {
  interactions: Map<string, IInteractionState>
  traces: Map<string, Set<string>>
}

/** Construct indexes before any target receives a retained event. */
export function createInteractionIndex(): IHubInteractionIndex {
  return { interactions: new Map(), traces: new Map() }
}

/**
 * Kind and direction witness caller/provider roles; physical traffic with no logical kind proves
 * neither.
 */
function interactionSide(event: IRpcDevtoolsTimelineEvent): number {
  /** Canonical public taxonomy prevents the hub from defining its own protocol string vocabulary. */
  const kind = event.event.kind
  /** Requests identify the caller outbound and the provider inbound; replies reverse those roles. */
  let reply: boolean
  if (
    kind === RpcProbeKindName[RpcProbeKind.request] ||
    kind === RpcProbeKindName[RpcProbeKind.notify] ||
    kind === RpcProbeKindName[RpcProbeKind.streamOpen]
  )
    reply = false
  else if (
    kind === RpcProbeKindName[RpcProbeKind.response] ||
    kind === RpcProbeKindName[RpcProbeKind.streamChunk] ||
    kind === RpcProbeKindName[RpcProbeKind.streamClose]
  )
    reply = true
  else return 0
  if (event.event.direction === RpcProbeDirectionName[RpcProbeDirection.outbound])
    return reply ? 2 : 1
  if (event.event.direction === RpcProbeDirectionName[RpcProbeDirection.inbound])
    return reply ? 1 : 2
  return 0
}

/**
 * Append one stored wrapper under its explicit identity without rescanning previously retained
 * events.
 */
export function indexInteraction(
  index: IHubInteractionIndex,
  event: IRpcDevtoolsTimelineEvent
): void {
  if (event.interaction === undefined) return
  /** This lookup selects the sole owner of an interaction's incremental membership. */
  let interaction = index.interactions.get(event.interaction)
  if (!interaction) {
    interaction = {
      view: {
        key: event.interaction,
        trace: event.trace,
        method: event.event.method,
        oneSided: true,
        targets: [],
        events: []
      },
      members: new Set(),
      targets: new Map(),
      traces: new Map(),
      outbound: 0,
      inbound: 0,
      dirty: true
    }
    index.interactions.set(event.interaction, interaction)
  }
  interaction.members.add(event)
  interaction.targets.set(event.target, (interaction.targets.get(event.target) ?? 0) + 1)
  /** Side ordinals are internal: 1 is an observed caller, 2 an observed provider, 0 unknown. */
  const side = interactionSide(event)
  if (side === 1) interaction.outbound++
  if (side === 2) interaction.inbound++
  if (event.trace) {
    if (!interaction.traces.has(event.trace)) {
      /** Trace keys contain only observed hops; the hub never synthesizes a missing side. */
      let keys = index.traces.get(event.trace)
      if (!keys) {
        keys = new Set()
        index.traces.set(event.trace, keys)
      }
      keys.add(event.interaction)
    }
    interaction.traces.set(event.trace, (interaction.traces.get(event.trace) ?? 0) + 1)
    interaction.view.trace ??= event.trace
  }
  interaction.view.method ??= event.event.method
  interaction.view.oneSided = interaction.outbound === 0 || interaction.inbound === 0
  interaction.dirty = true
}

/** Remove exactly the displaced event reference and drop empty interaction/trace keys immediately. */
export function unindexInteraction(
  index: IHubInteractionIndex,
  event: IRpcDevtoolsTimelineEvent
): void {
  if (event.interaction === undefined) return
  /** Ring displacement passes the stored identity, so membership removal is constant time. */
  const interaction = index.interactions.get(event.interaction)
  if (!interaction || !interaction.members.delete(event)) return
  /** Counts preserve a target until its last retained interaction member is removed. */
  const targetCount = interaction.targets.get(event.target)! - 1
  if (targetCount === 0) interaction.targets.delete(event.target)
  else interaction.targets.set(event.target, targetCount)
  /** Remove the same role witness used at ingestion, independent of target/host count. */
  const side = interactionSide(event)
  if (side === 1) interaction.outbound--
  if (side === 2) interaction.inbound--
  if (event.trace) {
    /** A trace must stop referencing this hop when its last matching event leaves retention. */
    const traceCount = interaction.traces.get(event.trace)! - 1
    if (traceCount === 0) {
      interaction.traces.delete(event.trace)
      /** Trace sets share the interaction key, without retaining an evicted event. */
      const keys = index.traces.get(event.trace)!
      keys.delete(event.interaction)
      if (keys.size === 0) index.traces.delete(event.trace)
    } else interaction.traces.set(event.trace, traceCount)
  }
  /** Invalidate the cached projection now so no index retains an evicted event reference. */
  interaction.view.events.length = 0
  interaction.view.targets.length = 0
  if (interaction.members.size === 0) {
    index.interactions.delete(event.interaction)
    return
  }
  interaction.view.trace = interaction.traces.keys().next().value
  interaction.view.oneSided = interaction.outbound === 0 || interaction.inbound === 0
  interaction.dirty = true
}

/**
 * Return stored interaction objects, projecting only changed membership into permitted result
 * arrays.
 */
export function queryInteractions(
  index: IHubInteractionIndex,
  trace?: string
): IRpcDevtoolsInteraction[] {
  /** Explicit traces select keys directly rather than scanning unrelated wire events. */
  const keys = trace === undefined ? index.interactions.keys() : index.traces.get(trace)?.values()
  /** SC9 permits result arrays whose elements are the stored readonly interaction objects. */
  const result: IRpcDevtoolsInteraction[] = []
  if (!keys) return result
  for (const key of keys) {
    /** Grouping is already maintained; this projection never derives correlation from a timeline. */
    const interaction = index.interactions.get(key)!
    if (interaction.dirty) {
      interaction.view.events = Array.from(interaction.members)
      interaction.view.targets = Array.from(interaction.targets.keys())
      interaction.dirty = false
    }
    result.push(interaction.view)
  }
  return result
}
