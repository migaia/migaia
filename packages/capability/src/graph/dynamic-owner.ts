import { unavailableRequiredProvider } from './provider-availability.js'
/**
 * Serializes the public dynamic graph operations and owns terminal admission. Pure topology and
 * dependency plans stay with their modules; frontier resource work uses dynamic-runtime context.
 */
import { createMutationQueue, type IEnqueueOptions, type IMutationQueue } from '@migaia/lifecycle'
import { CapabilityGraphErrorCode } from './error-code.js'
import { graphFailure } from './errors.js'
import { dynamicFailure, snapshotDynamicNode } from './dynamic-admission.js'
import {
  closureDynamicEntries,
  createDynamicContext,
  createDynamicTopologyIndex,
  dynamicBlockedReason,
  dynamicDependencyState,
  dynamicDiagnostics,
  dynamicMutationResult,
  orderedDynamicEntries,
  planDynamicMutation,
  releaseDynamicEntries,
  reportDynamicError,
  startDynamicEntries,
  type IDynamicGraphContext,
  type IDynamicStoredNode
} from './dynamic-runtime.js'
import {
  CapabilityGraphNodeState,
  CapabilityGraphState,
  GraphBindingReleaseReason,
  GraphBlockedReason
} from './state-constants.js'
import { planRestart } from './dependency.js'
import type { IGraphNodeDiagnostic, IGraphNodeId } from './index.js'
import type { IGraphDependents } from './topology.js'
import type {
  IDynamicCapabilityGraph,
  IDynamicCapabilityGraphOptions,
  IDynamicGraphNodeDefinition,
  IGraphBindingLease,
  IGraphDependencyMutationOptions,
  IGraphMutationResult,
  IGraphReplaceOptions
} from './dynamic.js'

/** Dynamic graph mutation coordinator; lifecycle remains the sole FIFO and lease owner. */
export class DynamicCapabilityGraph<TBinding> implements IDynamicCapabilityGraph<TBinding> {
  /** Definition/topology/resource facts shared explicitly with frontier reconciliation jobs. */
  #context: IDynamicGraphContext<TBinding>
  /** Accepted operations drain through the existing lifecycle FIFO, including final disposal. */
  #mutationQueue: IMutationQueue
  /** First final-cleanup completion is retained for exact repeated-dispose Promise identity. */
  #disposePromise: Promise<void> | undefined

  /** Admits the original live options before constructing the lifecycle mutation queue. */
  constructor(options: IDynamicCapabilityGraphOptions<TBinding>) {
    this.#context = createDynamicContext(options)
    if (
      !options ||
      typeof options.startBatch !== 'function' ||
      typeof options.releaseBatch !== 'function'
    )
      throw dynamicFailure(CapabilityGraphErrorCode.invalidOption)
    if (
      options.mutationAdmissionMs !== undefined &&
      (!Number.isFinite(options.mutationAdmissionMs) || options.mutationAdmissionMs < 0)
    )
      throw dynamicFailure(CapabilityGraphErrorCode.invalidOption)
    this.#mutationQueue = createMutationQueue({
      queueAdmissionTimeoutMs: options.mutationAdmissionMs ?? false
    })
  }

  /** Returns a frozen registration-order snapshot; terminal disposal leaves it empty. */
  get nodes(): readonly IGraphNodeId[] {
    return Object.freeze([...this.#context.definitions.keys()].map((id) => id as IGraphNodeId))
  }

  /** Container admission phase does not imply that every required provider is available. */
  get state() {
    return this.#context.graphState
  }

  /** Exposes the mutation counter without duplicating node lifecycle generation state. */
  get generation(): number {
    return this.#context.graphGeneration
  }

  /** Queues registration; caller definition getters remain unread until the FIFO admits it. */
  register = <T>(
    input: IDynamicGraphNodeDefinition<T>,
    binding?: TBinding
  ): Promise<IGraphMutationResult> => this.#mutate(() => this.#register(input, binding))

  /** Queues exact-target removal, preserving the existing reject/cascade policy boundary. */
  remove = (
    id: IGraphNodeId,
    options?: IGraphDependencyMutationOptions
  ): Promise<IGraphMutationResult> => this.#mutate(() => this.#remove(id, options))

  /** Queues suspension without physically releasing retained resources or binding custody. */
  suspend = (
    id: IGraphNodeId,
    options?: IGraphDependencyMutationOptions
  ): Promise<IGraphMutationResult> => this.#mutate(() => this.#suspend(id, options))

  /** Queues required-provider reconciliation for one suspended consumer frontier. */
  resume = (id: IGraphNodeId): Promise<IGraphMutationResult> => this.#mutate(() => this.#resume(id))

  /** Reads frozen direct required/optional consumers; absent targets retain UNKNOWN_NODE. */
  dependentsOf = (id: IGraphNodeId): IGraphDependents => {
    if (!this.#context.definitions.has(id))
      throw dynamicFailure(CapabilityGraphErrorCode.unknownNode)
    return this.#context.topologyIndex.dependents(id)
  }

  /** Queues definition replacement with unchanged notification and restart semantics. */
  replace = <T>(
    input: IDynamicGraphNodeDefinition<T>,
    binding?: TBinding,
    options?: IGraphReplaceOptions<TBinding>
  ): Promise<IGraphMutationResult> => this.#mutate(() => this.#replace(input, binding, options))

  /** Queues startup of satisfiable definitions without freezing dynamic registration. */
  ready = (): Promise<void> => this.#mutate(() => this.#ready())

  /** Returns a fresh unfrozen diagnostic projection retaining original payload references. */
  nodeState = (id: IGraphNodeId): IGraphNodeDiagnostic => {
    /** Actual registered entry is the sole source of node availability and binding state. */
    const entry = this.#context.definitions.get(id)
    if (!entry) throw dynamicFailure(CapabilityGraphErrorCode.unknownNode)
    /** All reads after a topology mutation share one canonical rank/level derivation. */
    const diagnostics = dynamicDiagnostics(this.#context)
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
  }

  /** Non-owning binding reads deliberately do not acquire leases or check availability. */
  getBinding = <T = TBinding>(id: IGraphNodeId): T | undefined =>
    this.#context.definitions.get(id)?.binding as T | undefined

  /** Retains one exact ready binding generation using lifecycle-owned idempotent release. */
  acquireBinding = (id: IGraphNodeId): IGraphBindingLease<TBinding> => {
    /** Unavailable definitions never gain binding-generation custody. */
    const entry = this.#context.definitions.get(id)
    if (!entry || entry.state !== CapabilityGraphNodeState.ready || entry.binding === undefined)
      throw dynamicFailure(CapabilityGraphErrorCode.providerUnavailable)
    return Object.freeze({
      value: entry.binding,
      release: this.#context.bindingLeases.retain(entry.leaseKey)
    })
  }

  /** Immediately closes admission, then joins final cleanup through the same canonical Promise. */
  dispose = (): Promise<void> => {
    if (this.#disposePromise) return this.#disposePromise
    this.#context.graphState = CapabilityGraphState.quiescing
    this.#disposePromise = this.#schedule(() => this.#dispose(), {
      queueAdmissionTimeoutMs: false
    })
    return this.#disposePromise
  }

  /** Preserves FIFO admission error identity and the original asynchronous mutation boundary. */
  #schedule<T>(task: () => Promise<T>, enqueueOptions?: IEnqueueOptions): Promise<T> {
    /** Distinguishes task failures from work the queue never admitted before its deadline. */
    let admitted = false
    return this.#mutationQueue
      .enqueue(async () => {
        admitted = true
        await undefined
        return task()
      }, enqueueOptions)
      .catch((error: unknown) => {
        if (admitted) throw error
        throw graphFailure(CapabilityGraphErrorCode.mutationAdmissionTimeout, error)
      })
  }

  /** Rejects later mutations after quiescence without changing accepted queued work. */
  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (
      this.#context.graphState === CapabilityGraphState.terminal ||
      this.#context.graphState === CapabilityGraphState.quiescing
    )
      return Promise.reject(dynamicFailure(CapabilityGraphErrorCode.graphDisposed))
    return this.#schedule(operation)
  }

  /** Admits one immutable definition, then starts only its required consumer frontier. */
  async #register(
    input: IDynamicGraphNodeDefinition<unknown>,
    binding: TBinding | undefined
  ): Promise<IGraphMutationResult> {
    /** Captured facts become visible only after the canonical topology admits them. */
    const node = snapshotDynamicNode(input)
    if (this.#context.definitions.has(node.id))
      throw dynamicFailure(CapabilityGraphErrorCode.duplicateNode)
    this.#context.topologyIndex.add({ id: node.id, dependencies: node.dependencies })
    this.#context.diagnosticCache = undefined
    this.#context.definitions.set(node.id, {
      definition: node,
      ordinal: this.#context.topologyIndex.registrationOrdinal(node.id),
      binding,
      state: CapabilityGraphNodeState.registered,
      generation: this.#context.graphGeneration,
      leaseKey: {}
    })
    this.#context.graphGeneration += 1
    /** The canonical required closure excludes unrelated registered definitions. */
    const affected = closureDynamicEntries(this.#context, [node.id])
    await startDynamicEntries(this.#context, affected)
    return dynamicMutationResult(this.#context, affected, true)
  }

  /** Releases exact affected instances before removing target topology and binding custody. */
  async #remove(
    id: IGraphNodeId,
    options: IGraphDependencyMutationOptions | undefined
  ): Promise<IGraphMutationResult> {
    /** Target identity is resolved before policy admission, matching the existing error order. */
    const target = this.#context.definitions.get(id)
    if (!target) throw dynamicFailure(CapabilityGraphErrorCode.unknownNode)
    /** Release order is derived once, independent of definition registration order. */
    const affected = orderedDynamicEntries(
      this.#context,
      planDynamicMutation(this.#context, id, options)
    )
    await releaseDynamicEntries(
      this.#context,
      affected,
      new Set([id]),
      GraphBindingReleaseReason.remove
    )
    this.#context.topologyIndex.remove(id)
    this.#context.diagnosticCache = undefined
    this.#context.definitions.delete(id)
    for (const entry of affected) {
      if (entry === target) continue
      entry.state = CapabilityGraphNodeState.blocked
      entry.error = undefined
      entry.blockedReason = GraphBlockedReason.removed
    }
    this.#context.graphGeneration += 1
    return dynamicMutationResult(this.#context, affected, true)
  }

  /** Blocks required consumers while retaining all instances and binding generations. */
  async #suspend(
    id: IGraphNodeId,
    options: IGraphDependencyMutationOptions | undefined
  ): Promise<IGraphMutationResult> {
    /** The requested definition must exist even if its old availability is already blocked. */
    const target = this.#context.definitions.get(id)
    if (!target) throw dynamicFailure(CapabilityGraphErrorCode.unknownNode)
    /** One pure policy plan determines the entire affected batch. */
    const affected = orderedDynamicEntries(
      this.#context,
      planDynamicMutation(this.#context, id, options)
    )
    target.state = CapabilityGraphNodeState.suspended
    target.blockedReason = undefined
    for (const entry of affected) {
      if (entry === target) continue
      entry.state = CapabilityGraphNodeState.blocked
      entry.blockedReason = GraphBlockedReason.suspended
    }
    this.#context.graphGeneration += 1
    return dynamicMutationResult(this.#context, affected, false)
  }

  /** Resumes retained resources in canonical order and starts only entries without instances. */
  async #resume(id: IGraphNodeId): Promise<IGraphMutationResult> {
    /** Resume never creates an absent definition or changes a nonsuspended target. */
    const target = this.#context.definitions.get(id)
    if (!target) throw dynamicFailure(CapabilityGraphErrorCode.unknownNode)
    if (target.state !== CapabilityGraphNodeState.suspended)
      throw dynamicFailure(CapabilityGraphErrorCode.nodeNotSuspended)
    /** Provider-first iteration lets later retained instances observe restored providers. */
    const affected = closureDynamicEntries(this.#context, [id])
    /** Missing resources are collected once instead of filtering the frontier again. */
    const missing: IDynamicStoredNode<TBinding>[] = []
    target.state = CapabilityGraphNodeState.ready
    target.blockedReason = undefined
    for (const entry of affected) {
      if (entry.instance === undefined) missing.push(entry)
      if (entry === target || !entry.instance) continue
      /** Each frontier dependency is inspected at most once in this reconciliation pass. */
      const unavailable = unavailableRequiredProvider(
        entry.definition.dependencies,
        this.#context.definitions
      )
      if (unavailable !== undefined) {
        entry.state = CapabilityGraphNodeState.blocked
        entry.blockedReason = dynamicBlockedReason(this.#context, unavailable)
        continue
      }
      entry.state = CapabilityGraphNodeState.ready
      entry.blockedReason = undefined
    }
    await startDynamicEntries(this.#context, missing)
    this.#context.graphGeneration += 1
    return dynamicMutationResult(this.#context, affected, false)
  }

  /** Replaces captured facts before reconciling the old/new required consumer union. */
  async #replace(
    input: IDynamicGraphNodeDefinition<unknown>,
    binding: TBinding | undefined,
    options: IGraphReplaceOptions<TBinding> | undefined
  ): Promise<IGraphMutationResult> {
    /** Replacement uses the exact same hostile-definition admission as registration. */
    const node = snapshotDynamicNode(input)
    /** Existing entry retains its ordinal and exact old generation until release completes. */
    const previous = this.#context.definitions.get(node.id)
    if (!previous) throw dynamicFailure(CapabilityGraphErrorCode.unknownNode)
    /** Old declarations establish whether topology facts can remain untouched. */
    const oldDependencies = previous.definition.dependencies
    /** The old required frontier must survive changed-edge replacement selection. */
    const oldAffected = this.#context.topologyIndex.closure([node.id])
    /** Ordered dependency equality preserves the existing same-edge replacement decision. */
    const sameTopology =
      oldDependencies.length === node.dependencies.length &&
      oldDependencies.every(
        (edge, index) =>
          edge.provider === node.dependencies[index]?.provider &&
          edge.required === node.dependencies[index]?.required
      )
    if (!sameTopology) {
      this.#context.topologyIndex.setDependencies(node.id, node.dependencies)
      this.#context.diagnosticCache = undefined
    }
    previous.definition = node
    /** Same-edge replacement reuses the frontier instead of rebuilding a redundant set. */
    let affectedIds: Iterable<string> = oldAffected
    if (!sameTopology) {
      /** Changed edges require one old/new union, ordered once by the canonical owner. */
      const combined = new Set(oldAffected)
      for (const id of this.#context.topologyIndex.closure([node.id])) combined.add(id)
      affectedIds = combined
    }
    /** Lifecycle entries remain provider-first independently of closure insertion order. */
    const affected = orderedDynamicEntries(this.#context, affectedIds)
    if (options?.restartDependents === false) {
      /** Notification mode restarts only the provider before handing off new binding identity. */
      const targetOnly = [previous]
      await releaseDynamicEntries(
        this.#context,
        targetOnly,
        new Set([node.id]),
        GraphBindingReleaseReason.replace
      )
      previous.binding = binding
      previous.state = CapabilityGraphNodeState.registered
      previous.error = undefined
      previous.blockedReason = undefined
      this.#context.graphGeneration += 1
      await startDynamicEntries(this.#context, targetOnly)
      /** Failed or absent notifications select direct consumers for one shared restart traversal. */
      const roots: string[] = []
      for (const dependent of this.#context.topologyIndex.dependents(node.id).required) {
        if (!options.onReplaced) {
          roots.push(dependent)
          continue
        }
        try {
          await options.onReplaced(dependent as IGraphNodeId, binding)
        } catch (error) {
          reportDynamicError(this.#context, error)
          roots.push(dependent)
        }
      }
      if (roots.length > 0) {
        /** One multi-root plan visits shared consumer closures once, retaining canonical order. */
        const restart = planRestart(
          this.#context.topologyIndex,
          (nodeId) => dynamicDependencyState(this.#context, nodeId),
          roots
        )
        if (restart.order.length > 0) {
          /** Physical cleanup still receives one provider-first batch and its exact fence. */
          const restartEntries = orderedDynamicEntries(this.#context, restart.order)
          await releaseDynamicEntries(
            this.#context,
            restartEntries,
            new Set(),
            GraphBindingReleaseReason.replace
          )
          await startDynamicEntries(this.#context, restartEntries)
        }
      }
      return dynamicMutationResult(this.#context, affected, !sameTopology)
    }
    await releaseDynamicEntries(
      this.#context,
      affected,
      new Set([node.id]),
      GraphBindingReleaseReason.replace
    )
    previous.binding = binding
    previous.state = CapabilityGraphNodeState.registered
    previous.error = undefined
    this.#context.graphGeneration += 1
    await startDynamicEntries(this.#context, affected)
    return dynamicMutationResult(this.#context, affected, !sameTopology)
  }

  /** Marks the container ready only after its current satisfiable frontier has settled. */
  async #ready(): Promise<void> {
    await startDynamicEntries(this.#context, orderedDynamicEntries(this.#context))
    this.#context.graphState = CapabilityGraphState.ready
  }

  /** Finishes accepted cleanup and drops all graph facts even if physical cleanup rejects. */
  async #dispose(): Promise<void> {
    try {
      /** One canonical whole-graph frontier drives one physical cleanup batch. */
      const entries = orderedDynamicEntries(this.#context)
      await releaseDynamicEntries(
        this.#context,
        entries,
        new Set(entries.map((entry) => entry.definition.id)),
        GraphBindingReleaseReason.dispose
      )
    } finally {
      this.#context.definitions.clear()
      // No definition remains observable after terminal admission; release the old topology in
      // one step instead of invoking affected-region removal once per node (quadratic in a chain).
      this.#context.topologyIndex = createDynamicTopologyIndex()
      this.#context.diagnosticCache = undefined
      this.#context.graphState = CapabilityGraphState.terminal
      this.#context.graphGeneration += 1
    }
  }
}
