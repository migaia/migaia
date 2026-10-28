/**
 * Owns pure dependency mutation and recovery planning over topology facts. Exposes frozen plans;
 * state, resource execution and lifecycle ownership remain with consumers.
 */
import { createDependencyReadonlySet } from './dependency-set.js'
import { CapabilityGraphErrorCode } from './error-code.js'
import { graphFailure, graphMessageFor } from './errors.js'
import type { ITopologyDependency, ITopologyIndexReader } from './topology.js'

/** Pure-planner policies for mutations affecting required consumers; no lifecycle work is executed. */
export const DependencyPolicy = {
  /** Return a blocked plan when required consumers outside the requested roots are present. */
  reject: 'reject',
  /** Give the full required-consumer closure the root mutation action. */
  cascade: 'cascade',
  /** Mutate roots but suspend already activated required consumers instead of releasing them. */
  suspend: 'suspend'
} as const

/** Accepted mutation policies; planner requests supply one explicitly. */
export type DependencyPolicy = keyof typeof DependencyPolicy

/** Requested root mutation used to select release or disable actions. */
export const DependencyMutationKind = {
  /** Relinquish root resources and include release actions in a cascade. */
  remove: 'remove',
  /** Disable roots and include disable actions in a cascade. */
  disable: 'disable'
} as const

/** Root mutation domain, separate from individual planned step actions. */
export type DependencyMutationKind = keyof typeof DependencyMutationKind

/** Instructions for a composition owner to execute; producing a plan performs none of these actions. */
export const DependencyAction = {
  /** Release the node's resources. */
  release: 'release',
  /** Disable the node according to the composition owner's policy. */
  disable: 'disable',
  /** Retain an activated instance while withholding service. */
  suspend: 'suspend',
  /** Restore service from a retained, satisfiable instance. */
  resume: 'resume',
  /** Update a direct consumer to a replacement binding in place. */
  rebind: 'rebind',
  /** Reconstruct an activated instance against its providers. */
  restart: 'restart',
  /** Start a required provider that has not yet activated. */
  activate: 'activate',
  /** Mark a suspended retained instance stale rather than starting it immediately. */
  invalidate: 'invalidate'
} as const

/** Planned action labels consumed by an external execution owner. */
export type DependencyAction = keyof typeof DependencyAction

/** Additional status only for an optional edge whose provider is absent. */
export const DependencyEdgeStatus = {
  /** Optional provider is absent; this edge does not block activation or join required closure. */
  optionalAbsent: 'optional-absent'
} as const

/** Optional-edge diagnostic label, independent of node state. */
export type IDependencyEdgeStatus = (typeof DependencyEdgeStatus)[keyof typeof DependencyEdgeStatus]

/** Orthogonal runtime facts supplied by the composition owner; topology stores none of these flags. */
export type IDependencyNodeState = Readonly<{
  /** Whether the node has an activated instance, including a retained suspended instance. */
  readonly activated: boolean
  /** Whether configuration currently allows this node to serve. */
  readonly enabled: boolean
  /** Whether the activated instance is deliberately withheld from consumers. */
  readonly suspended: boolean
  /** Whether a retained instance must restart before it can resume. */
  readonly stale: boolean
}>

/** Reads current facts for a known topology ID; callers own consistency and callback failures. */
export type IDependencyStateReader = (id: string) => IDependencyNodeState

/** One immutable instruction in execution order. */
export type IDependencyPlanStep = Readonly<{
  /** Node affected by this instruction. */
  readonly id: string
  /** External work required; creating the instruction does not perform it. */
  readonly action: DependencyAction
}>

/** Edge evidence accompanying a plan, including optional consumers notified by an affected provider. */
export type IDependencyPlanEdge = Readonly<{
  /** Provider endpoint, which may be absent for an optional edge. */
  readonly provider: string
  /** Present consumer declaring the edge. */
  readonly consumer: string
  /** True for an edge excluded from required-dependent cascade semantics. */
  readonly optional: boolean
  /** Optional-absent only when an optional provider is not present; otherwise omitted. */
  readonly status?: IDependencyEdgeStatus
}>

/** Deeply frozen result describing work and rejection facts without mutating topology or resources. */
export type IDependencyPlan = Readonly<{
  /** Ordered execution instructions; empty when reject policy reports blockers. */
  readonly steps: readonly IDependencyPlanStep[]
  /** Node IDs projected from steps in the same order. */
  readonly order: readonly string[]
  /** Required internal and affected optional edge evidence in canonical consumer order. */
  readonly edges: readonly IDependencyPlanEdge[]
  /** Required consumers outside the roots that prevent a reject-policy mutation; otherwise empty. */
  readonly blockedBy: readonly string[]
}>

/** Explicit roots, root action, and required-consumer policy; no field receives a default. */
export type IDependencyMutationRequest = Readonly<{
  /** Present mutation roots; required-consumer closure includes these roots. */
  readonly roots: readonly string[]
  /** Remove selects release; disable selects disable. */
  readonly kind: DependencyMutationKind
  /** Reject, cascade, or suspend; unsupported values throw GRAPH_INVALID_OPTION. */
  readonly policy: DependencyPolicy
}>

/** Replacement target and the owner's decision about each direct consumer's rebind capability. */
export type IDependencyReplacementRequest = Readonly<{
  /** Present provider whose binding is changing. */
  readonly target: string
  /** True when an activated direct consumer can accept the new binding without restart. */
  readonly canRebind: (id: string) => boolean
}>

/** Recovery inputs; stale state and changed provider generations determine restart versus rebind. */
export type IDependencyResumeRequest = Readonly<{
  /** Present provider from which to traverse the suspended required-consumer frontier. */
  readonly provider: string
  /** Whether direct consumers need a new binding or restart, in addition to stale-state checks. */
  readonly generationChanged: boolean
  /** Whether a direct consumer can change binding in place when its provider generation changed. */
  readonly canRebind: (id: string) => boolean
}>

/** Throws the package-owned native TypeError for an unknown planner option. */
function invalidOption(): never {
  throw graphFailure(
    CapabilityGraphErrorCode.invalidOption,
    new TypeError(graphMessageFor(CapabilityGraphErrorCode.invalidOption))
  )
}

/** Deep-freezes a complete dependency plan without retaining mutable caller arrays. */
function createPlan(
  steps: readonly IDependencyPlanStep[],
  edges: readonly IDependencyPlanEdge[],
  blockedBy: readonly string[] = []
): IDependencyPlan {
  /** Frozen step objects retained by both `steps` and derived `order`. */
  const frozenSteps = Object.freeze(
    steps.map((step) => Object.freeze({ id: step.id, action: step.action }))
  )
  return Object.freeze({
    steps: frozenSteps,
    order: Object.freeze(frozenSteps.map((step) => step.id)),
    edges: Object.freeze(edges.map((edge) => Object.freeze({ ...edge }))),
    blockedBy: Object.freeze([...blockedBy])
  })
}

/** Returns true when one runtime value is a supported dependency policy. */
function isDependencyPolicy(value: unknown): value is DependencyPolicy {
  return (
    value === DependencyPolicy.reject ||
    value === DependencyPolicy.cascade ||
    value === DependencyPolicy.suspend
  )
}

/** Returns true when one runtime value is a supported dependency mutation kind. */
function isDependencyMutationKind(value: unknown): value is DependencyMutationKind {
  return value === DependencyMutationKind.remove || value === DependencyMutationKind.disable
}

/** Returns whether one activated node currently provides service to its dependents. */
function isServing(state: IDependencyNodeState): boolean {
  return state.activated && state.enabled && !state.suspended
}

/** Converts one canonical affected set to dependent-first order. */
function dependentFirst(index: ITopologyIndexReader, affected: ReadonlySet<string>): string[] {
  return [...index.order(affected)].reverse()
}

/** Returns whether every required provider serves now or will serve after earlier recovery. */
function requiredProvidersAvailable(
  index: ITopologyIndexReader,
  state: IDependencyStateReader,
  recoverable: ReadonlySet<string>,
  dependencies: readonly ITopologyDependency[]
): boolean {
  for (const dependency of dependencies) {
    if (!dependency.required) continue
    if (!index.has(dependency.provider)) return false
    /** Live provider state decides availability unless this plan already restores service. */
    const providerState = state(dependency.provider)
    if (recoverable.has(dependency.provider) && providerState.enabled) continue
    if (!isServing(providerState)) return false
  }
  return true
}

/** Collects the provider and suspended-only downstream frontier in canonical order. */
function collectResumeCandidates(
  index: ITopologyIndexReader,
  state: IDependencyStateReader,
  provider: string
): readonly string[] {
  /** Suspended nodes reachable without crossing a non-suspended dependent. */
  const candidates = new Set<string>()
  if (state(provider).suspended) candidates.add(provider)
  /** Providers whose direct required dependents still need inspection. */
  const queue = [provider]
  for (let position = 0; position < queue.length; position += 1) {
    /** Each admitted suspended provider expands its direct required frontier once. */
    const current = queue[position]!
    for (const dependent of index.dependents(current).required) {
      if (candidates.has(dependent) || !state(dependent).suspended) continue
      candidates.add(dependent)
      queue.push(dependent)
    }
  }
  return index.order(candidates)
}

/**
 * Returns frozen required internal edges plus affected optional relationships for the supplied
 * affected set. Optional absent-provider evidence is included for affected consumers; unrelated
 * edges are omitted. This projection neither changes the index nor executes lifecycle work.
 */
export function collectPlanEdges(
  index: ITopologyIndexReader,
  affected: ReadonlySet<string>
): readonly IDependencyPlanEdge[] {
  /** Edges emitted in canonical consumer and declaration order. */
  const edges: IDependencyPlanEdge[] = []
  /**
   * Consumers whose edges can qualify: the affected nodes themselves plus the optional dependents
   * of affected providers. Reading only this neighbourhood keeps a plan proportional to what it
   * changes; scanning `order()` made every plan O(nodes + edges).
   */
  const candidates = new Set<string>()
  for (const id of affected) {
    if (!index.has(id)) continue
    candidates.add(id)
    for (const consumer of index.dependents(id).optional) candidates.add(consumer)
  }
  for (const consumer of index.order(candidates)) {
    for (const dependency of index.dependencies(consumer)) {
      if (dependency.required) {
        if (affected.has(consumer) && affected.has(dependency.provider))
          edges.push({ provider: dependency.provider, consumer, optional: false })
        continue
      }
      if (affected.has(dependency.provider)) {
        edges.push({ provider: dependency.provider, consumer, optional: true })
      } else if (affected.has(consumer) && !index.has(dependency.provider)) {
        edges.push({
          provider: dependency.provider,
          consumer,
          optional: true,
          status: DependencyEdgeStatus.optionalAbsent
        })
      }
    }
  }
  return Object.freeze(edges.map((edge) => Object.freeze(edge)))
}

/**
 * Plans an explicit remove/disable request in dependent-first order. reject returns no steps plus
 * blockedBy when other required consumers exist; cascade applies the root action to the closure;
 * suspend retains activated consumers via suspend steps. Invalid policy or kind throws
 * GRAPH_INVALID_OPTION; unknown IDs follow the index adapter. No mutation or release is executed.
 */
export function planDependencyMutation(
  index: ITopologyIndexReader,
  state: IDependencyStateReader,
  request: IDependencyMutationRequest
): IDependencyPlan {
  if (!isDependencyPolicy(request.policy) || !isDependencyMutationKind(request.kind))
    invalidOption()
  /** Required dependent closure, including all roots. */
  const affected = new Set(index.closure(request.roots))
  /** Roots retain mutation action even when one is also another root's dependent. */
  const roots = new Set(request.roots)
  /** Required closure in teardown order. */
  const teardown = dependentFirst(index, affected)
  /** Edges describing internal required and externally affected optional relationships. */
  const edges = collectPlanEdges(index, affected)

  if (request.policy === DependencyPolicy.reject) {
    /** Constant-time root membership keeps blocker projection linear in the closure. */
    const blockedBy = teardown.filter((id) => !roots.has(id))
    if (blockedBy.length > 0) return createPlan([], edges, blockedBy)
  }

  /** Root kind selects the existing external teardown instruction. */
  const rootAction =
    request.kind === DependencyMutationKind.remove
      ? DependencyAction.release
      : DependencyAction.disable
  if (request.policy !== DependencyPolicy.suspend)
    return createPlan(
      teardown.map((id) => ({ id, action: rootAction })),
      edges
    )

  /** Suspend plan preserving dependent-first teardown order. */
  const steps: IDependencyPlanStep[] = []
  for (const id of teardown) {
    if (roots.has(id)) {
      steps.push({ id, action: rootAction })
      continue
    }
    /** Orthogonal state flags select only actions permitted by the planner contract. */
    const nodeState = state(id)
    if (nodeState.activated && !nodeState.suspended)
      steps.push({ id, action: DependencyAction.suspend })
  }
  return createPlan(steps, edges)
}

/**
 * Returns dependent-first restart steps for activated roots and required consumers. Inactive nodes
 * are omitted, and suspended instances receive invalidate instead of restart. Topology and state
 * are only read; the caller executes the returned frozen plan.
 */
export function planRestart(
  index: ITopologyIndexReader,
  state: IDependencyStateReader,
  roots: readonly string[]
): IDependencyPlan {
  /** Full required closure reached from restart roots. */
  const affected = new Set(index.closure(roots))
  /** Restart steps skip nodes that have never activated. */
  const steps = dependentFirst(index, affected).flatMap((id) => {
    /** Orthogonal state flags select only actions permitted by the planner contract. */
    const nodeState = state(id)
    if (!nodeState.activated) return []
    return [
      {
        id,
        action: nodeState.suspended ? DependencyAction.invalidate : DependencyAction.restart
      }
    ]
  })
  /** Edge projection covers only nodes participating in restart. */
  const planned = new Set(steps.map((step) => step.id))
  return createPlan(steps, collectPlanEdges(index, planned))
}

/**
 * Plans direct activated consumers as rebinds when canRebind permits, invalidates suspended
 * consumers, then appends dependent-first restart closures for the rest. The target itself has no
 * replacement step; its replacement remains the execution owner's responsibility.
 */
export function planReplacement(
  index: ITopologyIndexReader,
  state: IDependencyStateReader,
  request: IDependencyReplacementRequest
): IDependencyPlan {
  /** Direct activated consumers that can accept the replacement in place. */
  const rebinds: IDependencyPlanStep[] = []
  /** Direct suspended consumers whose retained binding becomes stale. */
  const invalidations: IDependencyPlanStep[] = []
  /** Direct activated consumers that require restart closure. */
  const restartRoots: string[] = []
  for (const dependent of index.dependents(request.target).required) {
    /** Only activated direct consumers own bindings affected by replacement. */
    const nodeState = state(dependent)
    if (!nodeState.activated) continue
    if (nodeState.suspended) {
      invalidations.push({ id: dependent, action: DependencyAction.invalidate })
      continue
    }
    if (request.canRebind(dependent))
      rebinds.push({ id: dependent, action: DependencyAction.rebind })
    else restartRoots.push(dependent)
  }
  /** One shared restart closure removes duplicate downstream traversal across roots. */
  const restarts =
    restartRoots.length === 0 ? createPlan([], []) : planRestart(index, state, restartRoots)
  /** Target is affected even though replacement execution is consumer-owned. */
  const affected = new Set([
    request.target,
    ...rebinds.map((step) => step.id),
    ...invalidations.map((step) => step.id),
    ...restarts.order
  ])
  return createPlan(
    [...rebinds, ...invalidations, ...restarts.steps],
    collectPlanEdges(index, affected)
  )
}

/**
 * Plans the suspended required-consumer frontier in provider-first order. Only nodes whose required
 * providers can serve are recoverable; stale instances restart, changed direct bindings rebind or
 * restart, and other recoverable instances resume. No startup, release, or state write occurs.
 */
export function planResume(
  index: ITopologyIndexReader,
  state: IDependencyStateReader,
  request: IDependencyResumeRequest
): IDependencyPlan {
  /** Suspended frontier reached without traversing the full dependent closure. */
  const candidates = collectResumeCandidates(index, state, request.provider)
  if (candidates.length === 0) return createPlan([], [])

  /** Candidates whose required providers can serve after earlier recovery steps. */
  const recoverable = new Set<string>()
  for (const id of candidates) {
    if (!requiredProvidersAvailable(index, state, recoverable, index.dependencies(id))) continue
    recoverable.add(id)
  }

  /** Recoverable direct consumers whose binding can change without restart. */
  const rebind = new Set<string>()
  /** Recoverable nodes whose retained instance must restart. */
  const restartRoots = new Set<string>()
  /** Generation-sensitive binding changes concern only the provider's direct consumers. */
  const direct = request.generationChanged
    ? new Set(index.dependents(request.provider).required)
    : new Set<string>()
  for (const id of recoverable) {
    /** Orthogonal state flags select only actions permitted by the planner contract. */
    const nodeState = state(id)
    if (nodeState.stale) {
      restartRoots.add(id)
      continue
    }
    if (!direct.has(id)) continue
    if (request.canRebind(id)) rebind.add(id)
    else restartRoots.add(id)
  }

  /** Candidate members in restart closures that can be reconstructed. */
  const restart = new Set<string>()
  /** Candidate members blocked behind a restart root remain stale and suspended. */
  const invalidate = new Set<string>()
  /** Candidate membership bounds restart propagation to the suspended frontier. */
  const candidateSet = new Set(candidates)
  /** All restart roots share one walk; overlapping downstream paths are visited once. */
  const queue = [...restartRoots]
  /** Membership is recorded at admission so duplicate edges cannot expand the queue. */
  const visited = new Set(restartRoots)
  for (let position = 0; position < queue.length; position += 1) {
    /** Candidate whose restart dominates any weaker recovery action. */
    const id = queue[position]!
    if (recoverable.has(id)) restart.add(id)
    else invalidate.add(id)
    for (const dependent of index.dependents(id).required) {
      if (visited.has(dependent) || !candidateSet.has(dependent)) continue
      visited.add(dependent)
      queue.push(dependent)
    }
  }

  /** Canonically ordered actions with restart semantics taking precedence over rebind. */
  const steps = candidates.flatMap((id): IDependencyPlanStep[] => {
    if (restart.has(id)) return [{ id, action: DependencyAction.restart }]
    if (invalidate.has(id)) return [{ id, action: DependencyAction.invalidate }]
    if (rebind.has(id)) return [{ id, action: DependencyAction.rebind }]
    if (recoverable.has(id)) return [{ id, action: DependencyAction.resume }]
    return []
  })
  return createPlan(
    steps,
    collectPlanEdges(index, new Set([request.provider, ...steps.map((step) => step.id)]))
  )
}

/**
 * Plans inactive required providers in provider-first order, excluding the requested roots from
 * steps. Traversal stops at already activated providers and ignores optional or absent providers;
 * root activation itself remains the composition owner's responsibility.
 */
export function planActivation(
  index: ITopologyIndexReader,
  state: IDependencyStateReader,
  roots: readonly string[]
): IDependencyPlan {
  /**
   * Inactive required providers reached upstream from the requested roots. The walk never enters an
   * activated provider: activation always activates a node's providers first, so everything above
   * an activated provider is already activated, and walking it would make every install under a
   * deep chain cost the whole ancestry.
   */
  const reached = new Set<string>()
  /** Root membership also prevents repeated work when a requested root is another root's provider. */
  const rootSet = new Set(roots)
  /** Upstream queue contains each root or inactive provider at most once. */
  const queue = [...rootSet]
  /** Queue membership remains distinct from provider reachability and root exclusion. */
  const queued = new Set(rootSet)
  for (let position = 0; position < queue.length; position += 1) {
    /** Each queued consumer contributes its required-provider edges once. */
    const consumer = queue[position]!
    for (const dependency of index.dependencies(consumer)) {
      if (!dependency.required || !index.has(dependency.provider)) continue
      if (reached.has(dependency.provider)) continue
      if (state(dependency.provider).activated) continue
      reached.add(dependency.provider)
      if (!queued.has(dependency.provider)) {
        queued.add(dependency.provider)
        queue.push(dependency.provider)
      }
    }
  }
  /** Inactive providers emitted in canonical order with constant-time root exclusion. */
  const activating: string[] = []
  for (const id of index.order(reached)) if (!rootSet.has(id)) activating.push(id)
  return createPlan(
    activating.map((id) => ({ id, action: DependencyAction.activate })),
    collectPlanEdges(index, new Set(activating))
  )
}

/**
 * Returns a mutation-incapable set of non-lazy batch members and their required providers within
 * the same batch, in canonical order. Lazy members are included when a selected member requires
 * them; optional edges and providers outside the batch do not expand selection. Nothing starts.
 */
export function resolveInstallSet(
  index: ITopologyIndexReader,
  members: readonly string[],
  isLazy: (id: string) => boolean
): ReadonlySet<string> {
  /** Batch boundary preventing traversal into already-installed external providers. */
  const memberSet = new Set(members)
  /** Members selected for immediate installation. */
  const selected = new Set<string>()
  /** Required-provider traversal seeded only by non-lazy members. */
  const queue: string[] = []
  for (const member of members) {
    if (isLazy(member) || selected.has(member)) continue
    selected.add(member)
    queue.push(member)
  }
  for (let position = 0; position < queue.length; position += 1) {
    /** Each queued consumer contributes its required-provider edges once. */
    const consumer = queue[position]!
    for (const dependency of index.dependencies(consumer)) {
      if (!dependency.required || !memberSet.has(dependency.provider)) continue
      if (selected.has(dependency.provider)) continue
      selected.add(dependency.provider)
      queue.push(dependency.provider)
    }
  }
  return createDependencyReadonlySet(index.order(selected))
}

/**
 * Returns a frozen release plan for every present node in inverse canonical order; does not dispose
 * resources.
 */
export function planTeardown(index: ITopologyIndexReader): IDependencyPlan {
  /** All present IDs in dependent-first order. */
  const order = [...index.order()].reverse()
  /** Entire graph participates in teardown edge reporting. */
  const affected = new Set(order)
  return createPlan(
    order.map((id) => ({ id, action: DependencyAction.release })),
    collectPlanEdges(index, affected)
  )
}
