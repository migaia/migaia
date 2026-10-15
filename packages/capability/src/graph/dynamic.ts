import {
  admitTopologyId,
  snapshotTopologyDependencies,
  type ITopologySnapshotFailure
} from './topology-admission.js'
import type { ICapabilityGraphNodeState, ICapabilityGraphState } from './state-constants.js'
import {
  CapabilityGraphNodeState,
  CapabilityGraphState,
  GraphBlockedReason,
  GraphBindingReleaseReason
} from './state-constants.js'

export { GraphBindingReleaseReason } from './state-constants.js'
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
  type ITopologyIndex
} from './topology.js'
import type {
  IGraphNodeDefinition,
  IGraphNodeDiagnostic,
  IGraphNodeId,
  IGraphNodeInstance
} from './index.js'
import {
  containAsyncRejection,
  createMutationQueue,
  createQuiescenceTracker
} from '@migaia/lifecycle'

/** Result returned after one dynamic graph mutation commits. */
export type IGraphMutationResult = Readonly<{
  readonly affected: readonly IGraphNodeId[]
  readonly topologyChanged: boolean
  readonly generation: number
}>

/** Policy used when a node still has required dependents. */
export type IGraphDependencyMutationPolicy = Exclude<
  DependencyPolicy,
  typeof DependencyPolicy.suspend
>

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

/**
 * Runtime-neutral dynamic graph options. The composition owner supplies `startBatch` and
 * `releaseBatch`; the graph owns ordering, reconciliation and binding custody only.
 */
export type IDynamicCapabilityGraphOptions<TBinding = unknown> = Readonly<{
  /**
   * Receives contained startup, release, and late failures without replacing the primary graph
   * result.
   */
  readonly report?: (error: unknown) => void
  /** Maximum time an accepted mutation may wait behind an older serialized mutation. */
  readonly mutationAdmissionMs?: number
  /** Composition-owned startup for one topologically ordered affected frontier. Required. */
  readonly startBatch: (
    entries: readonly IGraphStartEntry<TBinding>[]
  ) => readonly IGraphNodeInstance<unknown>[] | PromiseLike<readonly IGraphNodeInstance<unknown>[]>
  /** Composition-owned physical release for one sealed cascade. Required. */
  readonly releaseBatch: (
    entries: readonly IGraphReleaseEntry<TBinding>[],
    fence: Promise<void>
  ) => void | PromiseLike<void>
  /** Releases custody for an exact binding generation after its instance cleanup fence. */
  readonly releaseBinding?: (entry: IGraphBindingReleaseEntry<TBinding>) => void | PromiseLike<void>
}>

/** Identifies why one exact graph binding generation left the graph. */
export type IGraphBindingReleaseReason = GraphBindingReleaseReason

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
  blockedReason?: GraphBlockedReason
  generation: number
  instance?: IGraphNodeInstance<unknown>
  leaseKey: object
}

/** Creates a serialized dynamic graph with fail-closed required-edge reconciliation. */
export function createDynamicCapabilityGraph<TBinding = unknown>(
  options: IDynamicCapabilityGraphOptions<TBinding>
): IDynamicCapabilityGraph<TBinding> {
  const definitions = new Map<string, IStoredNode<TBinding>>()
  let graphState: ICapabilityGraphState = CapabilityGraphState.open
  let graphGeneration = 0
  let disposePromise: Promise<void> | undefined
  /** Sole authority for exact binding-generation acquire/seal/drain fences. */
  const bindingLeases = createQuiescenceTracker<object>()
  /** Reports secondary cleanup failures without changing the mutation primary. */
  const report = (error: unknown): void => {
    try {
      containAsyncRejection(options.report?.(error), () => undefined)
    } catch {
      // This final diagnostic sink contains its own throws and rejections without recursion.
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

  // The graph has no node-level start/release of its own; both batch owners are mandatory.
  if (
    !options ||
    typeof options.startBatch !== 'function' ||
    typeof options.releaseBatch !== 'function'
  )
    throw fail(CapabilityGraphErrorCode.invalidOption)
  if (
    options.mutationAdmissionMs !== undefined &&
    (!Number.isFinite(options.mutationAdmissionMs) || options.mutationAdmissionMs < 0)
  )
    throw fail(CapabilityGraphErrorCode.invalidOption)

  /**
   * Canonical FIFO owner for graph mutations. It arms the admission budget at enqueue time, so a
   * mutation queued behind a stuck predecessor is rejected even if that predecessor never settles.
   */
  const mutationQueue = createMutationQueue({
    queueAdmissionTimeoutMs: options.mutationAdmissionMs ?? false
  })

  /**
   * Serializes one graph mutation. A rejected predecessor does not block later mutations. A
   * mutation that never ran because its admission budget expired rejects with
   * `GRAPH_MUTATION_ADMISSION_TIMEOUT`, keeping the lifecycle timeout on `cause`.
   */
  const schedule = <T>(task: () => Promise<T>): Promise<T> => {
    /** True once the queue admitted this mutation; separates task failures from admission timeouts. */
    let admitted = false
    return mutationQueue
      .enqueue(async () => {
        admitted = true
        // Keep the mutation body asynchronous relative to the caller, as the former Promise chain did.
        await undefined
        return task()
      })
      .catch((error: unknown) => {
        if (admitted) throw error
        throw graphFailure(CapabilityGraphErrorCode.mutationAdmissionTimeout, error)
      })
  }

  /** Snapshots caller-owned node facts once before any topology or lifecycle side effect. */
  const snapshotNode = (
    input: IDynamicGraphNodeDefinition<unknown>
  ): IDynamicGraphNodeDefinition<unknown> => {
    if (!input || typeof input !== 'object') throw fail(CapabilityGraphErrorCode.invalidNode)
    /** Graph adapts the pure admission protocol while preserving original getter failures. */
    const invalid: ITopologySnapshotFailure = (reason, _nodeId, failure) => {
      /** Duplicate edges keep their existing graph code; structural input uses INVALID_NODE. */
      const code =
        reason === TopologyInvalidReason.duplicateEdge
          ? CapabilityGraphErrorCode.duplicateEdge
          : CapabilityGraphErrorCode.invalidNode
      if (failure) throw graphFailure(code, failure.cause)
      throw fail(code)
    }
    /** Caller fields are captured before validation so later mutation cannot rewrite graph facts. */
    let idValue: unknown
    /** Domain kind remains a nonempty string, independent of topology edge ownership. */
    let kind: unknown
    /** Original callable is captured once and invoked with its original definition receiver. */
    let start: unknown
    /** Shared topology admission owns membership, edge getters and duplicate checks. */
    let dependenciesValue: unknown
    try {
      idValue = input.id
      kind = input.kind
      start = input.start
      dependenciesValue = input.dependencies
    } catch (cause) {
      throw graphFailure(CapabilityGraphErrorCode.invalidNode, cause)
    }
    /** Stable identity used for lookup, callbacks and diagnostics throughout this registration. */
    const id = admitTopologyId(idValue, invalid)
    if (typeof kind !== 'string' || kind.length === 0 || typeof start !== 'function')
      throw fail(CapabilityGraphErrorCode.invalidNode)
    /** Immutable edges are shared by the lifecycle definition and the canonical index owner. */
    const dependencies = snapshotTopologyDependencies(dependenciesValue, id, invalid)
    if (dependencies.some((edge) => edge.provider === id))
      throw fail(CapabilityGraphErrorCode.duplicateEdge)
    return Object.freeze({
      id: id as IGraphNodeId,
      kind,
      dependencies: dependencies as IDynamicGraphNodeDefinition<unknown>['dependencies'],
      // This receiver boundary preserves method-style starts without rereading input.start.
      start: (context) => Reflect.apply(start, input, [context])
    })
  }

  /** Resolves one canonical index order into lifecycle entries. */
  const readOrderedEntries = (ids?: Iterable<string>): IStoredNode<TBinding>[] => {
    /** Frontier entries handed to the start or release owner. */
    const entries = topologyIndex.order(ids).map((id) => definitions.get(id)!)
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

  /** Starts only blocked/registered/failed nodes in deterministic dependency order. */
  const start = async (entries: readonly IStoredNode<TBinding>[]): Promise<void> => {
    const startable: IStoredNode<TBinding>[] = []
    const available = new Set(
      [...definitions.values()]
        .filter((entry) => entry.state === CapabilityGraphNodeState.ready)
        .map((entry) => entry.definition.id)
    )
    for (const entry of entries) {
      if (entry.state === CapabilityGraphNodeState.ready) continue
      const unavailable = entry.definition.dependencies.find(
        (edge) => edge.required && !available.has(edge.provider)
      )
      if (unavailable) {
        entry.state = CapabilityGraphNodeState.blocked
        entry.blockedReason = readBlockedReason(unavailable.provider)
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
      // The batch owner reports one failure for the whole frontier. A single-node batch names the
      // failed node exactly; in a larger batch the graph cannot tell which node caused it, so every
      // node is blocked with reason `failed`. Either way each node keeps the original error.
      /** True when the batch holds one node, so the failure is attributable to it. */
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
    register(input, binding) {
      return mutate(async () => {
        /** Snapshot at queue admission, preserving the existing mutation scheduling boundary. */
        const node = snapshotNode(input)
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
          generation: graphGeneration
        }
      })
    },
    remove(id, options) {
      return mutate(async () => {
        const target = definitions.get(id)
        if (!target) throw fail(CapabilityGraphErrorCode.unknownNode)
        const affected = readOrderedEntries(planMutation(id, options))
        await release(affected, new Set([id]), GraphBindingReleaseReason.remove)
        topologyIndex.remove(id)
        invalidateDiagnostics()
        definitions.delete(id)
        const affectedIds = new Set(affected.map((entry) => entry.definition.id))
        for (const entry of definitions.values())
          if (affectedIds.has(entry.definition.id)) {
            entry.state = CapabilityGraphNodeState.blocked
            entry.error = undefined
            entry.blockedReason = GraphBlockedReason.removed
          }
        graphGeneration += 1
        return {
          affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
          topologyChanged: true,
          generation: graphGeneration
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
          entry.blockedReason = GraphBlockedReason.suspended
        }
        graphGeneration += 1
        return {
          affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
          topologyChanged: false,
          generation: graphGeneration
        }
      })
    },
    resume(id) {
      return mutate(async () => {
        const target = definitions.get(id)
        if (!target) throw fail(CapabilityGraphErrorCode.unknownNode)
        if (target.state !== CapabilityGraphNodeState.suspended)
          throw fail(CapabilityGraphErrorCode.nodeNotSuspended)
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
          generation: graphGeneration
        }
      })
    },
    dependentsOf(id) {
      if (!definitions.has(id)) throw fail(CapabilityGraphErrorCode.unknownNode)
      return topologyIndex.dependents(id)
    },
    replace(input, binding, options) {
      return mutate(async () => {
        /** Replacement commits the same immutable node contract as first registration. */
        const node = snapshotNode(input)
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
          await release(targetOnly, new Set([node.id]), GraphBindingReleaseReason.replace)
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
            await release(restartEntries, new Set(), GraphBindingReleaseReason.replace)
            await start(restartEntries)
          }
          return {
            affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
            topologyChanged: !sameTopology,
            generation: graphGeneration
          }
        }
        await release(affected, new Set([node.id]), GraphBindingReleaseReason.replace)
        previous.binding = binding
        previous.state = CapabilityGraphNodeState.registered
        previous.error = undefined
        graphGeneration += 1
        await start(affected)
        return {
          affected: Object.freeze(affected.map((item) => item.definition.id as IGraphNodeId)),
          topologyChanged: !sameTopology,
          generation: graphGeneration
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
          await release(
            entries,
            new Set(entries.map((entry) => entry.definition.id)),
            GraphBindingReleaseReason.dispose
          )
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
