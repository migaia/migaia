import type { ICapabilityGraphNodeState, ICapabilityGraphState } from './state-constants.js'
import { CapabilityGraphNodeState, CapabilityGraphState } from './state-constants.js'
import { CapabilityGraphErrorCode } from './error-code.js'
import { graphFailure, graphMessageFor } from './errors.js'
import {
  DependencyMutationKind,
  DependencyPolicy,
  planDependencyMutation,
  planRestart,
  type IDependencyNodeState
} from './dependency.js'
import {
  createTopologyIndex,
  TopologyInvalidReason,
  type IGraphDependents,
  type ITopologyIndex,
  type ITopologyIndexMetrics
} from './topology.js'
import type {
  IGraphNodeDefinition,
  IGraphNodeDiagnostic,
  IGraphNodeId,
  IGraphNodeInstance
} from './index.js'
import { createQuiescenceTracker } from '@migaia/lifecycle'

/** Deterministic traversal counters for one dynamic mutation. */
export type IGraphTraversalMetrics = Readonly<{
  readonly visitedNodes: number
  readonly visitedEdges: number
  readonly queueOperations: number
  readonly queueTimeMs: number
  readonly fullScan: boolean
  readonly wallTimeMs: number
}>

/** Result returned after one dynamic graph mutation commits. */
export type IGraphMutationResult = Readonly<{
  readonly affected: readonly IGraphNodeId[]
  readonly topologyChanged: boolean
  readonly generation: number
  readonly metrics: IGraphTraversalMetrics
}>

/** Policy used when a node still has required dependents. */
export type IGraphDependencyMutationPolicy = 'reject' | 'cascade'

export type { IGraphDependents } from './topology.js'

/** Options for removal and suspension. */
export type IGraphDependencyMutationOptions = Readonly<{
  readonly policy?: IGraphDependencyMutationPolicy
}>

/** Controls whether replacement restarts or notifies dependent nodes. */
export type IGraphReplaceOptions<TBinding> = Readonly<{
  readonly restartDependents?: boolean
  readonly onReplaced?: (
    dependent: IGraphNodeId,
    nextBinding: TBinding | undefined
  ) => void | PromiseLike<void>
}>

/** Dynamic graph dependency edge; optional edges do not block or cascade. */
export type IDynamicGraphDependency = Readonly<{
  readonly provider: IGraphNodeId
  readonly required: boolean
}>

/** Dynamic node definition supporting required and optional provider edges. */
export type IDynamicGraphNodeDefinition<T> = Omit<IGraphNodeDefinition<T>, 'dependencies'> &
  Readonly<{ readonly dependencies: readonly IDynamicGraphDependency[] }>

/** Runtime-neutral dynamic graph options. */
export type IDynamicCapabilityGraphOptions<TBinding = unknown> = Readonly<{
  /**
   * Receives contained startup, release, and late failures without replacing the primary graph
   * result.
   */
  readonly report?: (error: unknown) => void
  /** Maximum time an accepted mutation may wait behind an older serialized mutation. */
  readonly mutationAdmissionMs?: number
  /** Composition-owned startup for one topologically ordered affected frontier. */
  readonly startBatch?: (
    entries: readonly IGraphStartEntry<TBinding>[]
  ) => readonly IGraphNodeInstance<unknown>[] | PromiseLike<readonly IGraphNodeInstance<unknown>[]>
  /** Composition-owned physical release for one sealed cascade. */
  readonly releaseBatch?: (
    entries: readonly IGraphReleaseEntry<TBinding>[],
    fence: Promise<void>
  ) => void | PromiseLike<void>
  /** Releases custody for an exact binding generation after its instance cleanup fence. */
  readonly releaseBinding?: (entry: IGraphBindingReleaseEntry<TBinding>) => void | PromiseLike<void>
}>

/** Identifies why one exact graph binding generation left the graph. */
export type IGraphBindingReleaseReason = 'remove' | 'replace' | 'dispose'

/** Exact binding custody released after graph-owned instance cleanup. */
export type IGraphBindingReleaseEntry<TBinding> = Readonly<{
  readonly id: IGraphNodeId
  readonly binding: TBinding
  readonly reason: IGraphBindingReleaseReason
}>

/** Exact binding-generation lease retained by a consumer until it no longer observes the value. */
export type IGraphBindingLease<TBinding> = Readonly<{
  readonly value: TBinding
  readonly release: () => void
}>

/** Immutable node information supplied to a composition startup owner. */
export type IGraphStartEntry<TBinding = unknown> = Readonly<{
  readonly id: IGraphNodeId
  readonly binding: TBinding | undefined
  readonly definition: IDynamicGraphNodeDefinition<unknown>
}>

/** Immutable view of one graph node supplied to a composition release owner. */
export type IGraphReleaseEntry<TBinding = unknown> = Readonly<{
  readonly id: IGraphNodeId
  readonly binding: TBinding | undefined
  readonly instance: IGraphNodeInstance<unknown>
}>

/** Dynamic required-edge graph used by composition owners. */
export type IDynamicCapabilityGraph<TBinding = unknown> = Readonly<{
  readonly nodes: readonly IGraphNodeId[]
  readonly state: ICapabilityGraphState
  readonly generation: number
  register<T>(
    node: IDynamicGraphNodeDefinition<T>,
    binding?: TBinding
  ): Promise<IGraphMutationResult>
  remove(id: IGraphNodeId, options?: IGraphDependencyMutationOptions): Promise<IGraphMutationResult>
  suspend(
    id: IGraphNodeId,
    options?: IGraphDependencyMutationOptions
  ): Promise<IGraphMutationResult>
  resume(id: IGraphNodeId): Promise<IGraphMutationResult>
  dependentsOf(id: IGraphNodeId): IGraphDependents
  replace<T>(
    node: IDynamicGraphNodeDefinition<T>,
    binding?: TBinding,
    options?: IGraphReplaceOptions<TBinding>
  ): Promise<IGraphMutationResult>
  ready(): Promise<void>
  nodeState(id: IGraphNodeId): IGraphNodeDiagnostic
  getBinding<T = TBinding>(id: IGraphNodeId): T | undefined
  acquireBinding(id: IGraphNodeId): IGraphBindingLease<TBinding>
  dispose(): Promise<void>
}>

type IStoredNode<TBinding> = {
  definition: IDynamicGraphNodeDefinition<unknown>
  readonly ordinal: number
  binding?: TBinding
  state: ICapabilityGraphNodeState
  value?: unknown
  error?: unknown
  blockedReason?: 'missing' | 'suspended' | 'removed' | 'failed'
  generation: number
  instance?: IGraphNodeInstance<unknown>
  leaseKey: object
}

type IMutableTraversalMetrics = {
  visitedNodes: number
  visitedEdges: number
  queueOperations: number
  fullScan: boolean
  startedAt: number
  queueTimeMs: number
}

/** Creates a serialized dynamic graph with fail-closed required-edge reconciliation. */
export function createDynamicCapabilityGraph<TBinding = unknown>(
  options: IDynamicCapabilityGraphOptions<TBinding> = {}
): IDynamicCapabilityGraph<TBinding> {
  const definitions = new Map<string, IStoredNode<TBinding>>()
  let serial = Promise.resolve()
  let graphState: ICapabilityGraphState = CapabilityGraphState.open
  let graphGeneration = 0
  let disposePromise: Promise<void> | undefined
  /** Sole authority for exact binding-generation acquire/seal/drain fences. */
  const bindingLeases = createQuiescenceTracker<object>()
  let traversalMetrics: IMutableTraversalMetrics = {
    visitedNodes: 0,
    visitedEdges: 0,
    queueOperations: 0,
    fullScan: false,
    startedAt: Date.now(),
    queueTimeMs: 0
  }
  /** Cumulative index counters captured at the start of the current mutation. */
  let topologyMetricBaseline: ITopologyIndexMetrics = { visitedNodes: 0, visitedEdges: 0 }

  /** Starts deterministic per-mutation instrumentation without changing graph semantics. */
  const beginMetrics = (queueTimeMs = 0): void => {
    topologyMetricBaseline = topologyIndex.metrics()
    traversalMetrics = {
      visitedNodes: 0,
      visitedEdges: 0,
      queueOperations: 0,
      fullScan: false,
      startedAt: Date.now(),
      queueTimeMs
    }
  }

  /** Freezes traversal counters for acceptance evidence and diagnostics. */
  const readMetrics = (): IGraphTraversalMetrics => {
    /** Raw topology-index counters for the accepted mutation. */
    const current = topologyIndex.metrics()
    /** Index node visits made by this mutation (closure, ordering, level upkeep). */
    const visitedNodes = current.visitedNodes - topologyMetricBaseline.visitedNodes
    /** Index edge visits made by this mutation. */
    const visitedEdges = current.visitedEdges - topologyMetricBaseline.visitedEdges
    return Object.freeze({
      visitedNodes,
      visitedEdges,
      queueOperations: traversalMetrics.queueOperations,
      queueTimeMs: traversalMetrics.queueTimeMs,
      fullScan: traversalMetrics.fullScan,
      wallTimeMs: Math.max(0, Date.now() - traversalMetrics.startedAt)
    })
  }

  /** Reports secondary cleanup failures without changing the mutation primary. */
  const report = (error: unknown): void => {
    try {
      options.report?.(error)
    } catch {
      // Diagnostics are intentionally observer-only.
    }
  }

  /** Constructs a canonical graph error while retaining the package-owned message. */
  const fail = (code: (typeof CapabilityGraphErrorCode)[keyof typeof CapabilityGraphErrorCode]) =>
    graphFailure(code, graphMessageFor(code))

  /** Canonical incremental owner for adjacency, closure, ordering, and cycle admission. */
  const topologyIndex: ITopologyIndex = createTopologyIndex({
    onCycle: () => {
      throw fail(CapabilityGraphErrorCode.dependencyCycle)
    },
    onInvalid: (reason) => {
      if (reason === TopologyInvalidReason.duplicateNode)
        throw fail(CapabilityGraphErrorCode.duplicateNode)
      if (reason === TopologyInvalidReason.unknownNode)
        throw fail(CapabilityGraphErrorCode.unknownNode)
      throw fail(CapabilityGraphErrorCode.invalidNode)
    }
  })

  if (
    options.mutationAdmissionMs !== undefined &&
    (!Number.isFinite(options.mutationAdmissionMs) || options.mutationAdmissionMs < 0)
  )
    throw fail(CapabilityGraphErrorCode.invalidOption)

  /** Serializes graph mutations while allowing a rejected predecessor to recover the queue. */
  const schedule = <T>(task: () => Promise<T>): Promise<T> => {
    const enqueuedAt = Date.now()
    const run = async (): Promise<T> => {
      const budget = options.mutationAdmissionMs
      if (budget !== undefined && Date.now() - enqueuedAt > budget)
        throw fail(CapabilityGraphErrorCode.invalidOption)
      const queueTimeMs = Math.max(0, Date.now() - enqueuedAt)
      beginMetrics(queueTimeMs)
      return task()
    }
    const next = serial.then(run, run)
    serial = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  /** Copies the public node contract before any topology or lifecycle side effect. */
  const validateNode = (node: IDynamicGraphNodeDefinition<unknown>): void => {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || node.id.length === 0)
      throw fail(CapabilityGraphErrorCode.invalidNode)
    if (typeof node.kind !== 'string' || node.kind.length === 0 || typeof node.start !== 'function')
      throw fail(CapabilityGraphErrorCode.invalidNode)
    if (!Array.isArray(node.dependencies)) throw fail(CapabilityGraphErrorCode.invalidNode)
    const seen = new Set<string>()
    for (const dependency of node.dependencies) {
      if (
        !dependency ||
        typeof dependency.provider !== 'string' ||
        dependency.provider.length === 0 ||
        typeof dependency.required !== 'boolean'
      )
        throw fail(CapabilityGraphErrorCode.invalidNode)
      if (dependency.provider === node.id || seen.has(dependency.provider))
        throw fail(CapabilityGraphErrorCode.duplicateEdge)
      seen.add(dependency.provider)
    }
  }

  /** Resolves one canonical index order into lifecycle entries. */
  const readOrderedEntries = (ids?: Iterable<string>): IStoredNode<TBinding>[] => {
    if (!ids) traversalMetrics.fullScan = true
    /** Frontier entries handed to the start or release owner. */
    const entries = topologyIndex.order(ids).map((id) => definitions.get(id)!)
    traversalMetrics.queueOperations += entries.length
    return entries
  }

  /**
   * Canonical rank and level per node for `nodeState`, rebuilt at most once per topology change.
   * Deriving them per call built a full snapshot each time, which made a loop over `nodes` calling
   * `nodeState` quadratic.
   */
  let diagnosticCache: { rank: Map<string, number>; level: ReadonlyMap<string, number> } | undefined
  /** Drops the cached ranks after any topology mutation. */
  const invalidateDiagnostics = (): void => {
    diagnosticCache = undefined
  }
  /** Returns the cached ranks, rebuilding them from one snapshot when stale. */
  const readDiagnostics = (): { rank: Map<string, number>; level: ReadonlyMap<string, number> } => {
    if (diagnosticCache) return diagnosticCache
    const snapshot = topologyIndex.snapshot()
    diagnosticCache = {
      rank: new Map(snapshot.ordered.map((node, position) => [node.id, position])),
      level: snapshot.level
    }
    return diagnosticCache
  }

  /** Resolves the required dependent closure in canonical provider-first order. */
  const readClosureEntries = (roots: readonly string[]): IStoredNode<TBinding>[] =>
    readOrderedEntries(topologyIndex.closure(roots))

  /** Projects runtime node state into the pure planner's orthogonal state flags. */
  const readDependencyState = (id: string): IDependencyNodeState => {
    const state = definitions.get(id)?.state
    return {
      activated:
        state === CapabilityGraphNodeState.ready || state === CapabilityGraphNodeState.suspended,
      enabled: true,
      suspended: state === CapabilityGraphNodeState.suspended,
      stale: false
    }
  }

  /** Plans a remove or suspend frontier and preserves the dynamic reject error payload. */
  const planMutation = (
    id: string,
    options: IGraphDependencyMutationOptions | undefined
  ): readonly string[] => {
    const policy = options?.policy ?? DependencyPolicy.cascade
    if (policy !== DependencyPolicy.reject && policy !== DependencyPolicy.cascade)
      throw fail(CapabilityGraphErrorCode.invalidOption)
    const plan = planDependencyMutation(topologyIndex, readDependencyState, {
      roots: [id],
      kind: DependencyMutationKind.remove,
      policy
    })
    if (plan.blockedBy.length > 0)
      throw graphFailure(
        CapabilityGraphErrorCode.nodeHasDependents,
        graphMessageFor(CapabilityGraphErrorCode.nodeHasDependents),
        { dependents: topologyIndex.dependents(id).required }
      )
    return plan.order
  }

  /** Releases a frontier in inverse dependency order and reports secondary failures. */
  const release = async (
    entries: readonly IStoredNode<TBinding>[],
    bindingIds: ReadonlySet<string>,
    reason: IGraphBindingReleaseReason
  ): Promise<void> => {
    const leasedEntries = entries.filter((entry) => entry.instance !== undefined)
    for (const entry of leasedEntries) bindingLeases.seal(entry.leaseKey)
    const fence = Promise.all(
      leasedEntries.map((entry) => bindingLeases.whenZero(entry.leaseKey))
    ).then(() => undefined)
    if (options.releaseBatch) {
      const releasable = entries
        .filter(
          (entry): entry is IStoredNode<TBinding> & { instance: IGraphNodeInstance<unknown> } =>
            entry.instance !== undefined
        )
        .map((entry) => ({
          id: entry.definition.id,
          binding: entry.binding,
          instance: entry.instance
        }))
      if (releasable.length > 0) await options.releaseBatch(releasable, fence)
      for (const entry of entries) {
        entry.instance = undefined
        entry.value = undefined
        entry.state = CapabilityGraphNodeState.registered
        entry.leaseKey = {}
      }
      await releaseBindings(entries, bindingIds, reason)
      return
    }
    for (const entry of [...entries].reverse()) {
      if (!entry.instance) continue
      const instance = entry.instance
      await bindingLeases.whenZero(entry.leaseKey)
      entry.instance = undefined
      entry.value = undefined
      entry.state = CapabilityGraphNodeState.registered
      entry.leaseKey = {}
      try {
        await instance.release({
          signal: { aborted: false, reason: undefined } as never,
          nodeId: entry.definition.id,
          report
        })
      } catch (error) {
        report(error)
      }
    }
    await releaseBindings(entries, bindingIds, reason)
  }

  /** Releases only bindings whose definitions actually leave the graph. */
  const releaseBindings = async (
    entries: readonly IStoredNode<TBinding>[],
    bindingIds: ReadonlySet<string>,
    reason: IGraphBindingReleaseReason
  ): Promise<void> => {
    if (!options.releaseBinding) return
    for (const entry of entries) {
      if (!bindingIds.has(entry.definition.id) || entry.binding === undefined) continue
      try {
        await options.releaseBinding({
          id: entry.definition.id as IGraphNodeId,
          binding: entry.binding,
          reason
        })
      } catch (error) {
        report(error)
      }
    }
  }

  /** Preserves the nearest supported provider failure reason in blocked diagnostics. */
  const readBlockedReason = (provider: string): IStoredNode<TBinding>['blockedReason'] => {
    const entry = definitions.get(provider)
    if (entry?.state === CapabilityGraphNodeState.suspended) return 'suspended'
    if (entry?.state === CapabilityGraphNodeState.failed || entry?.blockedReason === 'failed')
      return 'failed'
    if (entry?.blockedReason === 'removed') return 'removed'
    if (entry?.blockedReason === 'suspended') return 'suspended'
    return 'missing'
  }

  /** Starts only blocked/registered/failed nodes in deterministic dependency order. */
  const start = async (entries: readonly IStoredNode<TBinding>[]): Promise<void> => {
    if (options.startBatch) {
      const startable: IStoredNode<TBinding>[] = []
      const available = new Set(
        [...definitions.values()]
          .filter((entry) => entry.state === CapabilityGraphNodeState.ready)
          .map((entry) => entry.definition.id)
      )
      for (const entry of entries) {
        if (entry.state === CapabilityGraphNodeState.ready) continue
        const missing = entry.definition.dependencies.some(
          (edge) => edge.required && !available.has(edge.provider)
        )
        if (missing) {
          entry.state = CapabilityGraphNodeState.blocked
          entry.blockedReason = 'missing'
          continue
        }
        startable.push(entry)
        available.add(entry.definition.id)
      }
      if (startable.length === 0) return
      let instances: readonly IGraphNodeInstance<unknown>[]
      try {
        instances = await options.startBatch(
          startable.map((entry) => ({
            id: entry.definition.id,
            binding: entry.binding,
            definition: entry.definition
          }))
        )
        if (!Array.isArray(instances) || instances.length !== startable.length)
          throw fail(CapabilityGraphErrorCode.invalidNode)
      } catch (error) {
        const failedEntry = startable[0]
        for (const entry of entries) {
          if (entry === failedEntry) {
            entry.state = CapabilityGraphNodeState.failed
            entry.error = error
          } else if (entry.state !== CapabilityGraphNodeState.ready) {
            entry.state = CapabilityGraphNodeState.blocked
            entry.error = undefined
            entry.blockedReason = failedEntry ? 'failed' : 'missing'
          }
        }
        throw graphFailure(CapabilityGraphErrorCode.startFailed, error)
      }
      for (let index = 0; index < startable.length; index += 1) {
        const entry = startable[index]
        const instance = instances[index]
        if (!instance || typeof instance !== 'object' || typeof instance.release !== 'function')
          throw fail(CapabilityGraphErrorCode.invalidNode)
        entry.instance = instance
        entry.value = instance.value
        entry.error = undefined
        entry.blockedReason = undefined
        entry.state = CapabilityGraphNodeState.ready
        entry.generation = graphGeneration
      }
      return
    }
    let failedEntry: IStoredNode<TBinding> | undefined
    try {
      for (const entry of entries) {
        if (entry.state === CapabilityGraphNodeState.ready) continue
        const unavailable = entry.definition.dependencies.find(
          (edge) =>
            edge.required &&
            definitions.get(edge.provider)?.state !== CapabilityGraphNodeState.ready
        )
        if (unavailable) {
          entry.state = CapabilityGraphNodeState.blocked
          entry.blockedReason = readBlockedReason(unavailable.provider)
          continue
        }
        const context = {
          nodeId: entry.definition.id,
          signal: { aborted: false, reason: undefined } as never,
          get: <T>(provider: IGraphNodeId): T => {
            const value = definitions.get(provider)?.value
            if (value === undefined) throw fail(CapabilityGraphErrorCode.providerUnavailable)
            return value as T
          },
          own: <T>(resource: T): T => resource
        }
        let instance: IStoredNode<TBinding>['instance']
        failedEntry = entry
        instance = await entry.definition.start(context)
        if (!instance || typeof instance !== 'object' || typeof instance.release !== 'function')
          throw fail(CapabilityGraphErrorCode.invalidNode)
        entry.instance = instance
        entry.value = instance.value
        entry.error = undefined
        entry.blockedReason = undefined
        entry.state = CapabilityGraphNodeState.ready
        entry.generation = graphGeneration
        failedEntry = undefined
      }
    } catch (error) {
      for (const entry of entries) {
        if (entry === failedEntry) {
          entry.state = CapabilityGraphNodeState.failed
          entry.error = error
        } else if (entry.state !== CapabilityGraphNodeState.ready) {
          entry.state = CapabilityGraphNodeState.blocked
          entry.error = undefined
          entry.blockedReason = failedEntry ? 'failed' : 'missing'
        }
      }
      throw graphFailure(CapabilityGraphErrorCode.startFailed, error)
    }
  }

  /** Rejects mutations after graph quiescence and serializes the accepted operation. */
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    if (
      graphState === CapabilityGraphState.terminal ||
      graphState === CapabilityGraphState.quiescing
    )
      return Promise.reject(fail(CapabilityGraphErrorCode.graphDisposed))
    return schedule(operation)
  }

  return {
    get nodes() {
      return Object.freeze([...definitions.keys()].map((id) => id as IGraphNodeId))
    },
    get state() {
      return graphState
    },
    get generation() {
      return graphGeneration
    },
    register(node, binding) {
      return mutate(async () => {
        validateNode(node)
        if (definitions.has(node.id)) throw fail(CapabilityGraphErrorCode.duplicateNode)
        const entry: IStoredNode<TBinding> = {
          definition: node,
          ordinal: definitions.size,
          binding,
          state: CapabilityGraphNodeState.registered,
          generation: graphGeneration,
          leaseKey: {}
        }
        topologyIndex.add({ id: node.id, dependencies: node.dependencies })
        invalidateDiagnostics()
        definitions.set(node.id, entry)
        graphGeneration += 1
        const affected = readClosureEntries([node.id])
        await start(affected)
        return {
          affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
          topologyChanged: true,
          generation: graphGeneration,
          metrics: readMetrics()
        }
      })
    },
    remove(id, options) {
      return mutate(async () => {
        const target = definitions.get(id)
        if (!target) throw fail(CapabilityGraphErrorCode.unknownNode)
        const affected = readOrderedEntries(planMutation(id, options))
        await release(affected, new Set([id]), 'remove')
        topologyIndex.remove(id)
        invalidateDiagnostics()
        definitions.delete(id)
        const affectedIds = new Set(affected.map((entry) => entry.definition.id))
        for (const entry of definitions.values())
          if (affectedIds.has(entry.definition.id)) {
            entry.state = CapabilityGraphNodeState.blocked
            entry.error = undefined
            entry.blockedReason = 'removed'
          }
        graphGeneration += 1
        return {
          affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
          topologyChanged: true,
          generation: graphGeneration,
          metrics: readMetrics()
        }
      })
    },
    suspend(id, options) {
      return mutate(async () => {
        const target = definitions.get(id)
        if (!target) throw fail(CapabilityGraphErrorCode.unknownNode)
        const affected = readOrderedEntries(planMutation(id, options))
        target.state = CapabilityGraphNodeState.suspended
        target.blockedReason = undefined
        for (const entry of affected) {
          if (entry === target) continue
          entry.state = CapabilityGraphNodeState.blocked
          entry.blockedReason = 'suspended'
        }
        graphGeneration += 1
        return {
          affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
          topologyChanged: false,
          generation: graphGeneration,
          metrics: readMetrics()
        }
      })
    },
    resume(id) {
      return mutate(async () => {
        const target = definitions.get(id)
        if (!target) throw fail(CapabilityGraphErrorCode.unknownNode)
        if (target.state !== CapabilityGraphNodeState.suspended)
          throw fail(CapabilityGraphErrorCode.invalidOption)
        const affected = readClosureEntries([id])
        target.state = CapabilityGraphNodeState.ready
        target.blockedReason = undefined
        // Topological order lets each retained instance observe its providers' resumed state; a
        // dependent that still has another suspended or unavailable provider stays blocked.
        for (const entry of affected) {
          if (entry === target || !entry.instance) continue
          const unavailable = entry.definition.dependencies.find(
            (edge) =>
              edge.required &&
              definitions.get(edge.provider)?.state !== CapabilityGraphNodeState.ready
          )
          if (unavailable) {
            entry.state = CapabilityGraphNodeState.blocked
            entry.blockedReason = readBlockedReason(unavailable.provider)
            continue
          }
          entry.state = CapabilityGraphNodeState.ready
          entry.blockedReason = undefined
        }
        await start(affected.filter((entry) => entry.instance === undefined))
        graphGeneration += 1
        return {
          affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
          topologyChanged: false,
          generation: graphGeneration,
          metrics: readMetrics()
        }
      })
    },
    dependentsOf(id) {
      if (!definitions.has(id)) throw fail(CapabilityGraphErrorCode.unknownNode)
      return topologyIndex.dependents(id)
    },
    replace(node, binding, options) {
      return mutate(async () => {
        validateNode(node)
        const previous = definitions.get(node.id)
        if (!previous) throw fail(CapabilityGraphErrorCode.unknownNode)
        const oldDependencies = previous.definition.dependencies
        const oldAffected = topologyIndex.closure([node.id])
        const sameTopology =
          oldDependencies.length === node.dependencies.length &&
          oldDependencies.every(
            (edge, index) =>
              edge.provider === node.dependencies[index]?.provider &&
              edge.required === node.dependencies[index]?.required
          )
        if (!sameTopology) {
          topologyIndex.setDependencies(node.id, node.dependencies)
          invalidateDiagnostics()
        }
        previous.definition = node
        const affected = readOrderedEntries(
          sameTopology
            ? oldAffected
            : new Set([...oldAffected, ...topologyIndex.closure([node.id])])
        )
        if (options?.restartDependents === false) {
          const targetOnly = [previous]
          await release(targetOnly, new Set([node.id]), 'replace')
          previous.binding = binding
          previous.state = CapabilityGraphNodeState.registered
          previous.error = undefined
          previous.blockedReason = undefined
          graphGeneration += 1
          await start(targetOnly)
          /** Dependents whose rebind is absent or failed; they restart with their own closure. */
          const restart = new Set<string>()
          for (const dependent of topologyIndex.dependents(node.id).required) {
            if (!options.onReplaced) {
              for (const item of planRestart(topologyIndex, readDependencyState, [dependent]).order)
                restart.add(item)
              continue
            }
            try {
              await options.onReplaced(dependent as IGraphNodeId, binding)
            } catch (error) {
              report(error)
              for (const item of planRestart(topologyIndex, readDependencyState, [dependent]).order)
                restart.add(item)
            }
          }
          if (restart.size > 0) {
            const restartEntries = readOrderedEntries(restart)
            await release(restartEntries, new Set(), 'replace')
            await start(restartEntries)
          }
          return {
            affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
            topologyChanged: !sameTopology,
            generation: graphGeneration,
            metrics: readMetrics()
          }
        }
        await release(affected, new Set([node.id]), 'replace')
        previous.binding = binding
        previous.state = CapabilityGraphNodeState.registered
        previous.error = undefined
        graphGeneration += 1
        await start(affected)
        return {
          affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
          topologyChanged: !sameTopology,
          generation: graphGeneration,
          metrics: readMetrics()
        }
      })
    },
    ready() {
      return mutate(async () => {
        await start(readOrderedEntries())
        graphState = CapabilityGraphState.ready
      })
    },
    nodeState(id) {
      const entry = definitions.get(id)
      if (!entry) throw fail(CapabilityGraphErrorCode.unknownNode)
      /** Cached canonical rank and level diagnostics. */
      const diagnostics = readDiagnostics()
      return {
        id,
        kind: entry.definition.kind,
        state: entry.state,
        value: entry.value,
        error: entry.error,
        reason: entry.blockedReason,
        binding: entry.binding,
        generation: entry.generation,
        ordinal: entry.ordinal,
        rank: diagnostics.rank.get(id) ?? -1,
        level: diagnostics.level.get(id) ?? 0
      }
    },
    getBinding<T = TBinding>(id: IGraphNodeId): T | undefined {
      return definitions.get(id)?.binding as T | undefined
    },
    acquireBinding(id) {
      const entry = definitions.get(id)
      if (!entry || entry.state !== CapabilityGraphNodeState.ready || entry.binding === undefined)
        throw fail(CapabilityGraphErrorCode.providerUnavailable)
      return Object.freeze({
        value: entry.binding,
        release: bindingLeases.retain(entry.leaseKey)
      })
    },
    dispose() {
      if (disposePromise) return disposePromise
      graphState = CapabilityGraphState.quiescing
      disposePromise = schedule(async () => {
        try {
          const entries = readOrderedEntries()
          await release(entries, new Set(entries.map((entry) => entry.definition.id)), 'dispose')
        } finally {
          definitions.clear()
          for (const id of topologyIndex.order()) topologyIndex.remove(id)
          invalidateDiagnostics()
          graphState = CapabilityGraphState.terminal
          graphGeneration += 1
        }
      })
      return disposePromise
    }
  }
}
