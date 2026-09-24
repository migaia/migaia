import type { ICapabilityGraphNodeState, ICapabilityGraphState } from './state-constants.js'
import { CapabilityGraphNodeState, CapabilityGraphState } from './state-constants.js'
import { CapabilityGraphErrorCode } from './error-code.js'
import { graphFailure, graphMessageFor } from './errors.js'
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

/** Direct consumers of one provider, separated by dependency strength. */
export type IGraphDependents = Readonly<{
  readonly required: readonly IGraphNodeId[]
  readonly optional: readonly IGraphNodeId[]
}>

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
  rank: number
  level: number
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
  /** Reverse adjacency is the sole incremental frontier index for dynamic reconciliation. */
  const consumersByProvider = new Map<string, Set<string>>()
  /** Forward adjacency supports O(1) changed-edge replacement and exact edge rollback. */
  const providersByConsumer = new Map<string, Set<string>>()
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

  /** Starts deterministic per-mutation instrumentation without changing graph semantics. */
  const beginMetrics = (queueTimeMs = 0): void => {
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
  const readMetrics = (): IGraphTraversalMetrics =>
    Object.freeze({
      visitedNodes: traversalMetrics.visitedNodes,
      visitedEdges: traversalMetrics.visitedEdges,
      queueOperations: traversalMetrics.queueOperations,
      queueTimeMs: traversalMetrics.queueTimeMs,
      fullScan: traversalMetrics.fullScan,
      wallTimeMs: Math.max(0, Date.now() - traversalMetrics.startedAt)
    })

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

  /** Produces a deterministic heap-ordered topology without rescanning the whole frontier. */
  const topology = (subset?: ReadonlySet<string>): IStoredNode<TBinding>[] => {
    if (!subset) traversalMetrics.fullScan = true
    const ids = subset ? [...subset] : [...definitions.keys()]
    traversalMetrics.visitedNodes += ids.length
    const indegree = new Map<string, number>()
    for (const id of ids) {
      const providers = providersByConsumer.get(id) ?? new Set<string>()
      traversalMetrics.visitedEdges += providers.size
      indegree.set(
        id,
        [...providers].filter((provider) =>
          subset ? subset.has(provider) : definitions.has(provider)
        ).length
      )
    }
    const ordered: IStoredNode<TBinding>[] = []
    const available: IStoredNode<TBinding>[] = []
    const push = (entry: IStoredNode<TBinding>): void => {
      available.push(entry)
      traversalMetrics.queueOperations += 1
      let index = available.length - 1
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2)
        if (available[parent]!.ordinal <= entry.ordinal) break
        available[index] = available[parent]!
        index = parent
      }
      available[index] = entry
    }
    const pop = (): IStoredNode<TBinding> | undefined => {
      const first = available[0]
      const last = available.pop()
      if (!first || !last || available.length === 0) return first
      let index = 0
      while (true) {
        const left = index * 2 + 1
        if (left >= available.length) break
        const right = left + 1
        const child =
          right < available.length && available[right]!.ordinal < available[left]!.ordinal
            ? right
            : left
        if (available[child]!.ordinal >= last.ordinal) break
        available[index] = available[child]!
        index = child
      }
      available[index] = last
      return first
    }
    for (const id of ids) if ((indegree.get(id) ?? 0) === 0) push(definitions.get(id)!)
    for (let entry = pop(); entry; entry = pop()) {
      ordered.push(entry)
      for (const consumer of consumersByProvider.get(entry.definition.id) ?? []) {
        traversalMetrics.visitedEdges += 1
        if (!indegree.has(consumer)) continue
        const next = indegree.get(consumer)! - 1
        indegree.set(consumer, next)
        if (next === 0) push(definitions.get(consumer)!)
      }
    }
    if (ordered.length !== ids.length) throw fail(CapabilityGraphErrorCode.dependencyCycle)
    return ordered
  }

  /** Returns the transitive consumer closure in topology order. */
  const collectClosure = (roots: readonly string[]): Set<string> => {
    const affected = new Set(roots)
    const queue = [...roots]
    traversalMetrics.queueOperations += queue.length
    for (const id of queue) {
      for (const consumer of consumersByProvider.get(id) ?? []) {
        const edge = definitions
          .get(consumer)
          ?.definition.dependencies.find((dependency) => dependency.provider === id)
        if (!edge?.required) continue
        if (!affected.has(consumer)) {
          affected.add(consumer)
          queue.push(consumer)
          traversalMetrics.queueOperations += 1
        }
      }
    }
    return affected
  }

  /** Reads direct dependents without exposing mutable adjacency state. */
  const readDependents = (id: string): IGraphDependents => {
    const required: IGraphNodeId[] = []
    const optional: IGraphNodeId[] = []
    for (const consumer of consumersByProvider.get(id) ?? []) {
      const edge = definitions
        .get(consumer)
        ?.definition.dependencies.find((dependency) => dependency.provider === id)
      const target = edge?.required ? required : optional
      target.push(consumer as IGraphNodeId)
    }
    return Object.freeze({ required: Object.freeze(required), optional: Object.freeze(optional) })
  }

  /** Rejects a dependency mutation before any graph state changes. */
  const assertDependencyPolicy = (
    id: string,
    options: IGraphDependencyMutationOptions | undefined
  ): void => {
    const policy = options?.policy ?? 'cascade'
    if (policy !== 'reject' && policy !== 'cascade')
      throw fail(CapabilityGraphErrorCode.invalidOption)
    const dependents = readDependents(id).required
    if (policy === 'reject' && dependents.length > 0)
      throw graphFailure(
        CapabilityGraphErrorCode.nodeHasDependents,
        graphMessageFor(CapabilityGraphErrorCode.nodeHasDependents),
        { dependents }
      )
  }

  /** Returns a deterministic topological affected frontier. */
  const closure = (roots: readonly string[]): IStoredNode<TBinding>[] => {
    const affected = collectClosure(roots)
    return topology(affected)
  }

  /** Updates forward and reverse adjacency for one admitted definition. */
  const setEdges = (id: string, dependencies: readonly { readonly provider: string }[]): void => {
    for (const provider of providersByConsumer.get(id) ?? []) {
      const consumers = consumersByProvider.get(provider)
      consumers?.delete(id)
      if (consumers?.size === 0) consumersByProvider.delete(provider)
    }
    const providers = new Set(dependencies.map((edge) => edge.provider))
    providersByConsumer.set(id, providers)
    for (const provider of providers) {
      let consumers = consumersByProvider.get(provider)
      if (!consumers) {
        consumers = new Set()
        consumersByProvider.set(provider, consumers)
      }
      consumers.add(id)
    }
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
          rank: definitions.size,
          level: node.dependencies.length,
          leaseKey: {}
        }
        definitions.set(node.id, entry)
        setEdges(node.id, node.dependencies)
        try {
          const affected = collectClosure([node.id])
          if (node.dependencies.some((edge) => affected.has(String(edge.provider))))
            throw fail(CapabilityGraphErrorCode.dependencyCycle)
          topology(affected)
        } catch (error) {
          for (const provider of providersByConsumer.get(node.id) ?? []) {
            const consumers = consumersByProvider.get(provider)
            consumers?.delete(node.id)
            if (consumers?.size === 0) consumersByProvider.delete(provider)
          }
          providersByConsumer.delete(node.id)
          definitions.delete(node.id)
          throw error
        }
        graphGeneration += 1
        const affected = closure([node.id])
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
        assertDependencyPolicy(id, options)
        const affected = closure([id])
        await release(affected, new Set([id]), 'remove')
        for (const provider of providersByConsumer.get(id) ?? []) {
          const consumers = consumersByProvider.get(provider)
          consumers?.delete(id)
          if (consumers?.size === 0) consumersByProvider.delete(provider)
        }
        providersByConsumer.delete(id)
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
        assertDependencyPolicy(id, options)
        const affected = closure([id])
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
        const affected = closure([id])
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
      return readDependents(id)
    },
    replace(node, binding, options) {
      return mutate(async () => {
        validateNode(node)
        const previous = definitions.get(node.id)
        if (!previous) throw fail(CapabilityGraphErrorCode.unknownNode)
        const oldDefinition = previous.definition
        const oldAffected = collectClosure([node.id])
        const oldProviders = providersByConsumer.get(node.id) ?? new Set<string>()
        const nextProviders = new Set<string>(
          node.dependencies.map((edge) => String(edge.provider))
        )
        const sameTopology =
          oldProviders.size === nextProviders.size &&
          [...oldProviders].every((provider) => nextProviders.has(provider))
        previous.definition = node
        if (!sameTopology) {
          setEdges(node.id, node.dependencies)
          try {
            const nextAffected = collectClosure([node.id])
            if (node.dependencies.some((edge) => nextAffected.has(String(edge.provider))))
              throw fail(CapabilityGraphErrorCode.dependencyCycle)
            topology(nextAffected)
          } catch (error) {
            previous.definition = oldDefinition
            setEdges(node.id, oldDefinition.dependencies)
            throw error
          }
        }
        const affected = topology(
          sameTopology ? oldAffected : new Set([...oldAffected, ...collectClosure([node.id])])
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
          for (const dependent of readDependents(node.id).required) {
            if (!options.onReplaced) {
              for (const item of collectClosure([dependent])) restart.add(item)
              continue
            }
            try {
              await options.onReplaced(dependent, binding)
            } catch (error) {
              report(error)
              for (const item of collectClosure([dependent])) restart.add(item)
            }
          }
          if (restart.size > 0) {
            const restartEntries = topology(restart)
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
        await start(topology())
        graphState = CapabilityGraphState.ready
      })
    },
    nodeState(id) {
      const entry = definitions.get(id)
      if (!entry) throw fail(CapabilityGraphErrorCode.unknownNode)
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
        rank: entry.rank,
        level: entry.level
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
          const entries = topology()
          await release(entries, new Set(entries.map((entry) => entry.definition.id)), 'dispose')
        } finally {
          definitions.clear()
          consumersByProvider.clear()
          providersByConsumer.clear()
          graphState = CapabilityGraphState.terminal
          graphGeneration += 1
        }
      })
      return disposePromise
    }
  }
}
