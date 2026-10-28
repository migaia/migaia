import { unavailableRequiredProvider } from './provider-availability.ts'
/**
 * Owns dynamic graph facts and frontier reconciliation through an explicit context. Startup and
 * physical cleanup stay with composition callbacks; leases stay with lifecycle.
 */
import { createQuiescenceTracker, type IQuiescenceTracker } from '@migaia/lifecycle'
import { invokeCapabilityReporter } from '../reporter.ts'
import { CapabilityGraphErrorCode } from './error-code.ts'
import { dynamicFailure } from './dynamic-admission.ts'
import { graphFailure, graphMessageFor } from './errors.ts'
import {
  CapabilityGraphNodeState,
  CapabilityGraphState,
  GraphBlockedReason,
  type GraphBindingReleaseReason,
  type ICapabilityGraphNodeState,
  type ICapabilityGraphState
} from './state-constants.ts'
import { createTopologyIndex, TopologyInvalidReason, type ITopologyIndex } from './topology.ts'
import {
  DependencyMutationKind,
  DependencyPolicy,
  planDependencyMutation,
  type IDependencyNodeState
} from './dependency.ts'
import type {
  IDynamicCapabilityGraphOptions,
  IDynamicGraphNodeDefinition,
  IGraphDependencyMutationOptions,
  IGraphMutationResult,
  IGraphReleaseEntry
} from './dynamic.ts'
import type { IGraphNodeInstance } from './index.ts'

/** One registered definition and its exact current binding/resource generation. */
export type IDynamicStoredNode<TBinding> = {
  definition: IDynamicGraphNodeDefinition<unknown>
  readonly ordinal: number
  binding?: TBinding
  state: ICapabilityGraphNodeState
  value?: unknown
  error?: unknown
  blockedReason?: GraphBlockedReason
  generation: number
  instance?: IGraphNodeInstance<unknown>
  leaseKey: object
}

/** Cached immutable-topology diagnostics, invalidated only when definitions or edges change. */
type IDynamicDiagnostics = {
  rank: Map<string, number>
  level: ReadonlyMap<string, number>
}

/** Explicit state shared by mutation orchestration and frontier lifecycle jobs. */
export type IDynamicGraphContext<TBinding> = {
  /** Composition callbacks remain live on the original options receiver. */
  readonly options: IDynamicCapabilityGraphOptions<TBinding>
  /** Definition ownership ends at remove or final graph disposal. */
  readonly definitions: Map<string, IDynamicStoredNode<TBinding>>
  /** Canonical topology owner; terminal disposal drops its complete old graph in one step. */
  topologyIndex: ITopologyIndex
  /** Lifecycle owns sealing and exact-generation drain accounting. */
  readonly bindingLeases: IQuiescenceTracker<object>
  /** Container admission state is independent of per-node availability. */
  graphState: ICapabilityGraphState
  /** Successful graph mutation counter, not a mirrored lifecycle generation controller. */
  graphGeneration: number
  /** Rank/level projection is rebuilt once after topology changes. */
  diagnosticCache?: IDynamicDiagnostics
}

/** Creates the canonical topology owner with the unchanged graph-specific error adapter. */
export function createDynamicTopologyIndex(): ITopologyIndex {
  return createTopologyIndex({
    onCycle: () => {
      throw dynamicFailure(CapabilityGraphErrorCode.dependencyCycle)
    },
    onInvalid: (reason) => {
      if (reason === TopologyInvalidReason.duplicateNode)
        throw dynamicFailure(CapabilityGraphErrorCode.duplicateNode)
      if (reason === TopologyInvalidReason.unknownNode)
        throw dynamicFailure(CapabilityGraphErrorCode.unknownNode)
      throw dynamicFailure(CapabilityGraphErrorCode.invalidNode)
    }
  })
}

/** Allocates graph-owned facts without reading caller options or starting any resource. */
export function createDynamicContext<TBinding>(
  options: IDynamicCapabilityGraphOptions<TBinding>
): IDynamicGraphContext<TBinding> {
  return {
    options,
    definitions: new Map(),
    graphState: CapabilityGraphState.open,
    graphGeneration: 0,
    bindingLeases: createQuiescenceTracker<object>(),
    topologyIndex: createDynamicTopologyIndex()
  }
}

/** Reports secondary cleanup/notification failures without changing the mutation primary. */
export function reportDynamicError<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  error: unknown
): void {
  invokeCapabilityReporter(() => context.options.report?.(error))
}

/** Resolves one canonical order into retained entries in O(V + E), without repeated lookups. */
export function orderedDynamicEntries<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  ids?: Iterable<string>
): IDynamicStoredNode<TBinding>[] {
  return context.topologyIndex.order(ids).map((id) => context.definitions.get(id)!)
}

/** Resolves a required consumer frontier in canonical provider-first order. */
export function closureDynamicEntries<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  roots: readonly string[]
): IDynamicStoredNode<TBinding>[] {
  return orderedDynamicEntries(context, context.topologyIndex.closure(roots))
}

/** Captures one mutation receipt without exposing mutable definition storage. */
export function dynamicMutationResult<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  entries: readonly IDynamicStoredNode<TBinding>[],
  topologyChanged: boolean
): IGraphMutationResult {
  return {
    affected: Object.freeze(entries.map((entry) => entry.definition.id)),
    topologyChanged,
    generation: context.graphGeneration
  }
}

/** Reads cached canonical ranks once per topology revision; subsequent key reads stay O(1). */
export function dynamicDiagnostics<TBinding>(
  context: IDynamicGraphContext<TBinding>
): IDynamicDiagnostics {
  if (context.diagnosticCache) return context.diagnosticCache
  /** One immutable snapshot supplies both projections for all node diagnostics. */
  const snapshot = context.topologyIndex.snapshot()
  context.diagnosticCache = {
    rank: new Map(snapshot.ordered.map((node, position) => [node.id, position])),
    level: snapshot.level
  }
  return context.diagnosticCache
}

/** Projects runtime node state into the planner's independent availability flags. */
export function dynamicDependencyState<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  id: string
): IDependencyNodeState {
  /** The graph's retained entry is the sole node availability authority. */
  const state = context.definitions.get(id)?.state
  return {
    activated:
      state === CapabilityGraphNodeState.ready || state === CapabilityGraphNodeState.suspended,
    enabled: true,
    suspended: state === CapabilityGraphNodeState.suspended,
    stale: false
  }
}

/** Plans one remove/suspend frontier and retains the existing reject error payload. */
export function planDynamicMutation<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  id: string,
  options: IGraphDependencyMutationOptions | undefined
): readonly string[] {
  /** Only the dynamic API's existing reject/cascade policies are admitted. */
  const policy = options?.policy ?? DependencyPolicy.cascade
  if (policy !== DependencyPolicy.reject && policy !== DependencyPolicy.cascade)
    throw dynamicFailure(CapabilityGraphErrorCode.invalidOption)
  /** The pure planner owns closure selection and never executes graph lifecycle work. */
  const plan = planDependencyMutation(
    context.topologyIndex,
    (nodeId) => dynamicDependencyState(context, nodeId),
    { roots: [id], kind: DependencyMutationKind.remove, policy }
  )
  if (plan.blockedBy.length > 0)
    throw graphFailure(
      CapabilityGraphErrorCode.nodeHasDependents,
      graphMessageFor(CapabilityGraphErrorCode.nodeHasDependents),
      { dependents: context.topologyIndex.dependents(id).required }
    )
  return plan.order
}

/** Releases only custody whose definition leaves the graph, containing each callback failure. */
async function releaseDynamicBindings<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  entries: readonly IDynamicStoredNode<TBinding>[],
  bindingIds: ReadonlySet<string>,
  reason: GraphBindingReleaseReason
): Promise<void> {
  if (!context.options.releaseBinding) return
  for (const entry of entries) {
    if (!bindingIds.has(entry.definition.id) || entry.binding === undefined) continue
    try {
      await context.options.releaseBinding({
        id: entry.definition.id,
        binding: entry.binding,
        reason
      })
    } catch (error) {
      reportDynamicError(context, error)
    }
  }
}

/** Seals one frontier and delegates exact-instance cleanup once; total graph work is O(V + E). */
export async function releaseDynamicEntries<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  entries: readonly IDynamicStoredNode<TBinding>[],
  bindingIds: ReadonlySet<string>,
  reason: GraphBindingReleaseReason
): Promise<void> {
  /** Only entries with live instances participate in the sealed cleanup fence. */
  const leasedEntries: IDynamicStoredNode<TBinding>[] = []
  for (const entry of entries) if (entry.instance !== undefined) leasedEntries.push(entry)
  for (const entry of leasedEntries) context.bindingLeases.seal(entry.leaseKey)
  /** The same non-rejecting exact-generation fence reaches the physical cleanup owner. */
  const fence = Promise.all(
    leasedEntries.map((entry) => context.bindingLeases.whenZero(entry.leaseKey))
  ).then(() => undefined)
  /** Physical owner receives provider-first entries and owns dependent-first execution. */
  const releasable: IGraphReleaseEntry<TBinding>[] = []
  for (const entry of entries)
    if (entry.instance !== undefined)
      releasable.push({ id: entry.definition.id, binding: entry.binding, instance: entry.instance })
  if (releasable.length > 0) await context.options.releaseBatch(releasable, fence)
  for (const entry of entries) {
    entry.instance = undefined
    entry.value = undefined
    entry.state = CapabilityGraphNodeState.registered
    entry.leaseKey = {}
  }
  await releaseDynamicBindings(context, entries, bindingIds, reason)
}

/** Retains the nearest unavailable provider's existing blocked diagnostic reason. */
export function dynamicBlockedReason<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  provider: string
): IDynamicStoredNode<TBinding>['blockedReason'] {
  /** Provider state and inherited reason remain independent of retained instance ownership. */
  const entry = context.definitions.get(provider)
  if (entry?.state === CapabilityGraphNodeState.suspended) return GraphBlockedReason.suspended
  if (
    entry?.state === CapabilityGraphNodeState.failed ||
    entry?.blockedReason === GraphBlockedReason.failed
  )
    return GraphBlockedReason.failed
  if (entry?.blockedReason === GraphBlockedReason.removed) return GraphBlockedReason.removed
  if (entry?.blockedReason === GraphBlockedReason.suspended) return GraphBlockedReason.suspended
  return GraphBlockedReason.missing
}

/** Starts satisfiable frontier entries once and publishes results in provider-first order. */
export async function startDynamicEntries<TBinding>(
  context: IDynamicGraphContext<TBinding>,
  entries: readonly IDynamicStoredNode<TBinding>[]
): Promise<void> {
  /** Startup batch excludes retained ready resources and unsatisfied required dependencies. */
  const startable: IDynamicStoredNode<TBinding>[] = []
  /** Earlier frontier providers satisfy later consumers before the batch result commits. */
  const available = new Set<string>()
  for (const entry of entries) {
    if (entry.state === CapabilityGraphNodeState.ready) continue
    /** First unavailable declaration determines the existing blocked reason precedence. */
    const unavailable = unavailableRequiredProvider(
      entry.definition.dependencies,
      context.definitions,
      available
    )
    if (unavailable !== undefined) {
      entry.state = CapabilityGraphNodeState.blocked
      entry.blockedReason = dynamicBlockedReason(context, unavailable)
      continue
    }
    startable.push(entry)
    available.add(entry.definition.id)
  }
  if (startable.length === 0) return
  /** Composition owns partial-start rollback and returns exact resource instances. */
  let instances: readonly IGraphNodeInstance<unknown>[]
  try {
    instances = await context.options.startBatch(
      startable.map((entry) => ({
        id: entry.definition.id,
        binding: entry.binding,
        definition: entry.definition
      }))
    )
    if (!Array.isArray(instances) || instances.length !== startable.length)
      throw dynamicFailure(CapabilityGraphErrorCode.invalidNode)
  } catch (error) {
    /** Only a single-node batch permits attributing the retained original failure. */
    const attributable = startable.length === 1
    for (const entry of startable) {
      entry.state = attributable
        ? CapabilityGraphNodeState.failed
        : CapabilityGraphNodeState.blocked
      entry.error = error
      entry.blockedReason = attributable ? undefined : GraphBlockedReason.failed
    }
    throw graphFailure(CapabilityGraphErrorCode.startFailed, error, {
      nodes: startable.map((entry) => entry.definition.id)
    })
  }
  for (let index = 0; index < startable.length; index += 1) {
    /** Canonical result position pairs each instance with its requested definition. */
    const entry = startable[index]
    /** Instance identity, release receiver and value getter remain composition-owned. */
    const instance = instances[index]
    if (!instance || typeof instance !== 'object' || typeof instance.release !== 'function')
      throw dynamicFailure(CapabilityGraphErrorCode.invalidNode)
    entry.instance = instance
    entry.value = instance.value
    entry.error = undefined
    entry.blockedReason = undefined
    entry.state = CapabilityGraphNodeState.ready
    entry.generation = context.graphGeneration
  }
}
