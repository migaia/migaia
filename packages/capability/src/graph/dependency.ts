import { CapabilityGraphErrorCode } from './error-code.js'
import { graphFailure, graphMessageFor } from './errors.js'
import type { ITopologyDependency, ITopologyIndexReader } from './topology.js'

export const DependencyPolicy = {
  reject: 'reject',
  cascade: 'cascade',
  suspend: 'suspend'
} as const

export type DependencyPolicy = keyof typeof DependencyPolicy

export const DependencyMutationKind = {
  remove: 'remove',
  disable: 'disable'
} as const

export type DependencyMutationKind = keyof typeof DependencyMutationKind

export const DependencyAction = {
  release: 'release',
  disable: 'disable',
  suspend: 'suspend',
  resume: 'resume',
  rebind: 'rebind',
  restart: 'restart',
  activate: 'activate',
  invalidate: 'invalidate'
} as const

export type DependencyAction = keyof typeof DependencyAction

export const DependencyEdgeStatus = {
  optionalAbsent: 'optional-absent'
} as const

export type IDependencyEdgeStatus = (typeof DependencyEdgeStatus)[keyof typeof DependencyEdgeStatus]

export type IDependencyNodeState = Readonly<{
  readonly activated: boolean
  readonly enabled: boolean
  readonly suspended: boolean
  readonly stale: boolean
}>

export type IDependencyStateReader = (id: string) => IDependencyNodeState

export type IDependencyPlanStep = Readonly<{
  readonly id: string
  readonly action: DependencyAction
}>

export type IDependencyPlanEdge = Readonly<{
  readonly provider: string
  readonly consumer: string
  readonly optional: boolean
  readonly status?: IDependencyEdgeStatus
}>

export type IDependencyPlan = Readonly<{
  readonly steps: readonly IDependencyPlanStep[]
  readonly order: readonly string[]
  readonly edges: readonly IDependencyPlanEdge[]
  readonly blockedBy: readonly string[]
}>

export type IDependencyMutationRequest = Readonly<{
  readonly roots: readonly string[]
  readonly kind: DependencyMutationKind
  readonly policy: DependencyPolicy
}>

export type IDependencyReplacementRequest = Readonly<{
  readonly target: string
  readonly canRebind: (id: string) => boolean
}>

export type IDependencyResumeRequest = Readonly<{
  readonly provider: string
  readonly generationChanged: boolean
  readonly canRebind: (id: string) => boolean
}>

/** Throws the package-owned native TypeError for an unknown planner option. */
function invalidOption(): never {
  throw graphFailure(
    CapabilityGraphErrorCode.invalidOption,
    new TypeError(graphMessageFor(CapabilityGraphErrorCode.invalidOption))
  )
}

/** Returns a mutation-incapable set facade over one immutable insertion order. */
function createReadonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
  /** Private lookup hidden behind the frozen facade. */
  const lookup = new Set(values)
  /** Frozen read-only set implementation. */
  const facade = {
    has: (value: T): boolean => lookup.has(value),
    get size(): number {
      return lookup.size
    },
    entries: (): SetIterator<[T, T]> => lookup.entries(),
    keys: (): SetIterator<T> => lookup.keys(),
    values: (): SetIterator<T> => lookup.values(),
    forEach: (callback: (value: T, value2: T, set: ReadonlySet<T>) => void): void => {
      for (const value of lookup) callback(value, value, facade)
    },
    [Symbol.iterator]: (): SetIterator<T> => lookup[Symbol.iterator]()
  } as ReadonlySet<T>
  return Object.freeze(facade)
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
    const current = queue[position]!
    for (const dependent of index.dependents(current).required) {
      if (candidates.has(dependent) || !state(dependent).suspended) continue
      candidates.add(dependent)
      queue.push(dependent)
    }
  }
  return index.order(candidates)
}

/** Collects deterministic plan edges for one affected node set. */
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

/** Plans reject, cascade, or suspend semantics without mutating the topology index. */
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
    const blockedBy = teardown.filter((id) => !roots.has(id))
    if (blockedBy.length > 0) return createPlan([], edges, blockedBy)
  }

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
    const nodeState = state(id)
    if (nodeState.activated && !nodeState.suspended)
      steps.push({ id, action: DependencyAction.suspend })
  }
  return createPlan(steps, edges)
}

/** Plans one dependent-first restart closure, excluding inactive nodes. */
export function planRestart(
  index: ITopologyIndexReader,
  state: IDependencyStateReader,
  roots: readonly string[]
): IDependencyPlan {
  /** Full required closure reached from restart roots. */
  const affected = new Set(index.closure(roots))
  /** Restart steps skip nodes that have never activated. */
  const steps = dependentFirst(index, affected).flatMap((id) => {
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

/** Plans direct rebinds first, then dependent-first restart closures. */
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

/** Plans recovery of satisfiable suspended dependents in provider-first canonical order. */
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
  const direct = request.generationChanged
    ? new Set(index.dependents(request.provider).required)
    : new Set<string>()
  for (const id of recoverable) {
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
  const candidateSet = new Set(candidates)
  for (const root of restartRoots) {
    /** Suspended-only restart traversal bounded by the candidate frontier. */
    const queue = [root]
    const visited = new Set<string>()
    for (let position = 0; position < queue.length; position += 1) {
      const id = queue[position]!
      if (visited.has(id) || !candidateSet.has(id)) continue
      visited.add(id)
      if (recoverable.has(id)) restart.add(id)
      else invalidate.add(id)
      for (const dependent of index.dependents(id).required) queue.push(dependent)
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

/** Plans inactive required providers before the requested activation roots. */
export function planActivation(
  index: ITopologyIndexReader,
  state: IDependencyStateReader,
  roots: readonly string[]
): IDependencyPlan {
  /** Required providers reached upstream from the requested roots. */
  const reached = new Set<string>()
  /** Upstream traversal queue. */
  const queue = [...roots]
  for (let position = 0; position < queue.length; position += 1) {
    const consumer = queue[position]!
    for (const dependency of index.dependencies(consumer)) {
      if (!dependency.required || !index.has(dependency.provider)) continue
      if (reached.has(dependency.provider)) continue
      reached.add(dependency.provider)
      queue.push(dependency.provider)
    }
  }
  /** Inactive providers emitted in canonical provider-first order. */
  const activating = index
    .order(reached)
    .filter((id) => !roots.includes(id) && !state(id).activated)
  return createPlan(
    activating.map((id) => ({ id, action: DependencyAction.activate })),
    collectPlanEdges(index, new Set(activating))
  )
}

/** Resolves immediate batch installation from non-lazy members and required providers. */
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
    if (isLazy(member)) continue
    selected.add(member)
    queue.push(member)
  }
  for (let position = 0; position < queue.length; position += 1) {
    const consumer = queue[position]!
    for (const dependency of index.dependencies(consumer)) {
      if (!dependency.required || !memberSet.has(dependency.provider)) continue
      if (selected.has(dependency.provider)) continue
      selected.add(dependency.provider)
      queue.push(dependency.provider)
    }
  }
  return createReadonlySet(index.order(selected))
}

/** Plans release of every present node in inverse canonical order. */
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
