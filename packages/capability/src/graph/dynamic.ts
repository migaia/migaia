/**
 * Declares the public dynamic graph contract and constructs its named mutation owner. Topology,
 * frontier reconciliation and physical resource execution remain with their existing owners.
 */
import { DynamicCapabilityGraph } from './dynamic-owner.js'
import type { ICapabilityGraphState } from './state-constants.js'
import { GraphBindingReleaseReason } from './state-constants.js'
export { GraphBindingReleaseReason } from './state-constants.js'
import { DependencyPolicy } from './dependency.js'
import { type IGraphDependents } from './topology.js'
import type {
  IGraphNodeDefinition,
  IGraphNodeDiagnostic,
  IGraphNodeId,
  IGraphNodeInstance
} from './index.js'

/** Result returned after one dynamic graph mutation commits. */
export type IGraphMutationResult = Readonly<{
  /** Affected node IDs in provider-first canonical order, not physical release order. */
  readonly affected: readonly IGraphNodeId[]
  /** Whether definitions or dependency edges changed, rather than only availability. */
  readonly topologyChanged: boolean
  /** Graph mutation counter after this operation; not the generation of every affected node. */
  readonly generation: number
}>

/** Dynamic remove/suspend policy: reject or cascade; pure-planner suspend is not accepted here. */
export type IGraphDependencyMutationPolicy = Exclude<
  DependencyPolicy,
  typeof DependencyPolicy.suspend
>

export type { IGraphDependents } from './topology.js'

/** Options for removal and suspension. */
export type IGraphDependencyMutationOptions = Readonly<{
  /** Defaults to cascade; reject refuses a target that still has required dependents. */
  readonly policy?: IGraphDependencyMutationPolicy
}>

/** Controls whether replacement restarts or notifies dependent nodes. */
export type IGraphReplaceOptions<TBinding> = Readonly<{
  /**
   * Defaults to restarting the required-consumer closure. Set false to attempt notification of
   * direct consumers; absent or failed onReplaced still falls back to their restart closure.
   */
  readonly restartDependents?: boolean
  /**
   * Optional direct-consumer notification used only when restartDependents is false. Receives the
   * next binding, which may be undefined; failures are reported before that consumer is restarted.
   */
  readonly onReplaced?: (
    dependent: IGraphNodeId,
    nextBinding: TBinding | undefined
  ) => void | PromiseLike<void>
}>

/** Dynamic provider edge; optional absence does not block service or join required cascade. */
export type IDynamicGraphDependency = Readonly<{
  /** Nonempty provider ID, including a provider registered later. */
  readonly provider: IGraphNodeId
  /**
   * Whether service requires this provider; present optional edges still participate in topology
   * ordering.
   */
  readonly required: boolean
}>

/** Dynamic node definition supporting required and optional provider edges. */
export type IDynamicGraphNodeDefinition<T> = Omit<IGraphNodeDefinition<T>, 'dependencies'> &
  Readonly<{
    /** Required and optional edges captured at mutation admission; duplicate providers are rejected. */
    readonly dependencies: readonly IDynamicGraphDependency[]
  }>

/**
 * Runtime-neutral dynamic graph options. The composition owner supplies `startBatch` and
 * `releaseBatch`; the graph owns ordering, reconciliation and binding custody only.
 */
export type IDynamicCapabilityGraphOptions<TBinding = unknown> = Readonly<{
  /**
   * Receives contained startup, release, and late failures without replacing the primary graph
   * result. Omitted by default; reporter failures reach the shared terminal reporting channel.
   */
  readonly report?: (error: unknown) => void
  /**
   * Ordinary mutation queue budget; final dispose waits in the same FIFO without this admission
   * timeout. Omitted means no admission deadline; provided values must be finite nonnegative
   * milliseconds. The budget limits queue waiting, not the runtime of an admitted mutation.
   */
  readonly mutationAdmissionMs?: number
  /**
   * Required composition-owned startup for a provider-first frontier. Return one valid instance per
   * entry in the same order, and own partial-start rollback if the batch fails. Graph does not
   * invoke definition.start itself; an unattributable multi-node failure blocks the whole batch.
   */
  readonly startBatch: (
    entries: readonly IGraphStartEntry<TBinding>[]
  ) => readonly IGraphNodeInstance<unknown>[] | PromiseLike<readonly IGraphNodeInstance<unknown>[]>
  /**
   * Required physical cleanup owner. Entries arrive provider-first; await fence before cleanup and
   * release in dependent-first order. Graph seals new leases, but this callback must honor the
   * supplied fence and perform instance.release itself before resolving.
   */
  readonly releaseBatch: (
    entries: readonly IGraphReleaseEntry<TBinding>[],
    fence: Promise<void>
  ) => void | PromiseLike<void>
  /**
   * Optional custody release after releaseBatch completes, for non-undefined bindings removed,
   * replaced, or finally disposed. Failures are reported without stopping other custody releases.
   */
  readonly releaseBinding?: (entry: IGraphBindingReleaseEntry<TBinding>) => void | PromiseLike<void>
}>

/** Exact binding custody released after graph-owned instance cleanup. */
export type IGraphBindingReleaseEntry<TBinding> = Readonly<{
  /** Identity whose exact binding generation is leaving graph custody. */
  readonly id: IGraphNodeId
  /** Original binding reference, not a later replacement. */
  readonly binding: TBinding
  /** Remove, replace, or dispose; suspension does not release custody. */
  readonly reason: GraphBindingReleaseReason
}>

/** Exact binding-generation lease retained by a consumer until it no longer observes the value. */
export type IGraphBindingLease<TBinding> = Readonly<{
  /** Exact binding reference admitted while its node was ready. */
  readonly value: TBinding
  /** Idempotently releases this lease; retaining it keeps the generation's cleanup fence pending. */
  readonly release: () => void
}>

/** Read-only startup view supplied to the composition owner; referenced payloads are not cloned. */
export type IGraphStartEntry<TBinding = unknown> = Readonly<{
  /** Stable identity of the requested startup. */
  readonly id: IGraphNodeId
  /** Composition-provided binding, omitted when none was registered. */
  readonly binding: TBinding | undefined
  /** Captured definition whose start behavior the batch owner may execute. */
  readonly definition: IDynamicGraphNodeDefinition<unknown>
}>

/**
 * Read-only cleanup view supplied to the composition owner; referenced resources stay owned until
 * release.
 */
export type IGraphReleaseEntry<TBinding = unknown> = Readonly<{
  /** Stable identity of this released instance. */
  readonly id: IGraphNodeId
  /** Binding associated with this instance, not a replacement generation. */
  readonly binding: TBinding | undefined
  /** Primary instance whose physical release the batch owner must perform. */
  readonly instance: IGraphNodeInstance<unknown>
}>

/** Dynamic required-edge graph used by composition owners. */
export type IDynamicCapabilityGraph<TBinding = unknown> = Readonly<{
  /** Frozen registration-order ID snapshot; final disposal removes all definitions. */
  readonly nodes: readonly IGraphNodeId[]
  /** Container state; ready does not imply every node has its required providers. */
  readonly state: ICapabilityGraphState
  /** Mutation counter, initially zero; readiness alone does not advance it. */
  readonly generation: number
  /**
   * Queues admission of a new definition and optional binding, then starts its satisfiable
   * required-consumer frontier. Missing providers leave nodes blocked; a start failure rejects
   * while retaining the admitted definition and its diagnostic for later reconciliation.
   */
  register<T>(
    node: IDynamicGraphNodeDefinition<T>,
    binding?: TBinding
  ): Promise<IGraphMutationResult>
  /**
   * Removes the target definition and binding after cleanup. Default cascade releases required
   * consumers but retains their definitions as blocked; reject refuses any required consumers.
   */
  remove(id: IGraphNodeId, options?: IGraphDependencyMutationOptions): Promise<IGraphMutationResult>
  /**
   * Withholds the target and blocks required consumers without releasing their instances or
   * bindings. Defaults to cascade; reject refuses a target with required consumers.
   */
  suspend(
    id: IGraphNodeId,
    options?: IGraphDependencyMutationOptions
  ): Promise<IGraphMutationResult>
  /**
   * Restores a suspended target and satisfiable retained consumers, starting only missing
   * instances. Other unavailable required providers keep consumers blocked; a nonsuspended target
   * rejects with GRAPH_NODE_NOT_SUSPENDED.
   */
  resume(id: IGraphNodeId): Promise<IGraphMutationResult>
  /** Returns frozen direct required/optional consumer lists; an absent ID throws GRAPH_UNKNOWN_NODE. */
  dependentsOf(id: IGraphNodeId): IGraphDependents
  /**
   * Queues replacement of a present definition and binding, preserving its registration ordinal.
   * Defaults to restarting required consumers; false restartDependents attempts onReplaced with
   * restart fallback. Same-edge replacement preserves canonical rank and level.
   */
  replace<T>(
    node: IDynamicGraphNodeDefinition<T>,
    binding?: TBinding,
    options?: IGraphReplaceOptions<TBinding>
  ): Promise<IGraphMutationResult>
  /**
   * Queues startup of currently satisfiable nodes and sets container ready; blocked nodes may
   * remain.
   */
  ready(): Promise<void>
  /**
   * Returns a fresh, unfrozen diagnostic projection with original value/binding references; unknown
   * IDs throw.
   */
  nodeState(id: IGraphNodeId): IGraphNodeDiagnostic
  /**
   * Reads a binding without checking node availability or acquiring a lease; absent IDs return
   * undefined.
   */
  getBinding<T = TBinding>(id: IGraphNodeId): T | undefined
  /**
   * Returns a frozen lease for a ready non-undefined binding; unavailable or sealed generations
   * reject.
   */
  acquireBinding(id: IGraphNodeId): IGraphBindingLease<TBinding>
  /**
   * Immediately closes admission, then queues final cleanup behind accepted work without an
   * admission timeout. Repeated calls share the exact Promise. Definitions are cleared and state
   * becomes terminal even if releaseBatch rejects; the composition owner must honor lease fences.
   */
  dispose(): Promise<void>
}>

/**
 * Creates a dynamic dependency coordinator with caller-supplied startup and physical cleanup.
 * Required startBatch/releaseBatch owners execute resources; the graph serializes mutations FIFO,
 * reconciles required availability, and owns exact binding-generation lease fences. Ordinary
 * mutation deadlines are disabled by default, and missing providers may remain blocked. This is
 * distinct from static Graph's single startup transaction and does not supply batch rollback.
 */
export function createDynamicCapabilityGraph<TBinding = unknown>(
  options: IDynamicCapabilityGraphOptions<TBinding>
): IDynamicCapabilityGraph<TBinding> {
  return new DynamicCapabilityGraph(options)
}
