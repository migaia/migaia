/**
 * Owns incremental topology facts, edge admission and isolated transaction publication. Exposes the
 * public index contract; resource lifecycle and dependency policy stay outside L0.
 */
import { OverlayStore, type IKeyedStore, type IStoredTopologyNode } from './topology-store.js'
import { TopologyTransaction } from './topology-transaction.js'
import { TopologyLevelQueue } from './topology-level-queue.js'
import { orderTopologyNodes, registrationTopologyNodes } from './topology-order.js'
import {
  retainTopologyFailure,
  createTopologyReadonlyMap,
  snapshotTopologyDependencies,
  snapshotTopologyIndexNode
} from './topology-admission.js'
import {
  TopologyInvalidReason,
  type ICapabilityTopology,
  type ITopologyDependency,
  type ITopologyInvalidReason,
  type ITopologyNode
} from './topology.js'

/** Required caller-owned error policy, copied when the empty index is created. */
export type ITopologyIndexAdapter = Readonly<{
  /** Throws the caller's error for a stable closed cycle path, before a mutation is committed. */
  readonly onCycle: (path: readonly string[]) => never
  /** Getter failures include their exact cause; the pure owner preserves it on the thrown error. */
  readonly onInvalid: (
    reason: ITopologyInvalidReason,
    nodeId?: string,
    failure?: { readonly cause: unknown }
  ) => never
}>

/** Incremental node input; the index assigns its own monotonic registration ordinal. */
export type ITopologyIndexNode = Readonly<{
  /** Unique nonempty ID retained through dependency replacement. */
  readonly id: string
  /** Captured edges; missing providers remain as dangling facts until admitted. */
  readonly dependencies: readonly ITopologyDependency[]
}>

/** Frozen direct-consumer IDs partitioned by edge kind, each in registration order. */
export type IGraphDependents = Readonly<{
  /** Consumers whose service requires this provider. */
  readonly required: readonly string[]
  /** Consumers observing this provider without joining required-dependent closure. */
  readonly optional: readonly string[]
}>

/** Read-only topology view shared by an index and its isolated transaction working view. */
export type ITopologyIndexReader = Readonly<{
  /** Number of currently present nodes. */
  readonly size: number
  /** Reports whether an ID is present without rejecting an unknown ID. */
  has(id: string): boolean
  /**
   * Stable registration ordinal owned by the index; unlike snapshot ordinals, removals do not
   * renumber it.
   */
  registrationOrdinal(id: string): number
  /** Returns the frozen captured edges; unknown IDs use the adapter's unknown-node failure. */
  dependencies(id: string): readonly ITopologyDependency[]
  /** Returns required and optional direct consumers for a present provider. */
  dependents(id: string): IGraphDependents
  /** Returns declared edges whose providers are absent, preserving declaration order. */
  missing(id: string): readonly ITopologyDependency[]
  /** Returns roots and transitive required consumers in canonical level/ordinal order. */
  closure(roots: readonly string[]): readonly string[]
  /** Returns all IDs by default, or a deduplicated known subset, in canonical order. */
  order(ids?: Iterable<string>): readonly string[]
  /** Returns a frozen static projection with mutation-incapable maps and newly dense ordinals. */
  snapshot(): ICapabilityTopology
}>

/** Atomic topology edits; structural failures use the supplied adapter before committing changes. */
export type ITopologyIndexWriter = Readonly<{
  /** Captures a new node and assigns an ordinal; duplicate IDs and cycles reject the edit. */
  add(node: ITopologyIndexNode): void
  /** Removes a present node, retaining its consumers' edges as dangling provider references. */
  remove(id: string): void
  /** Replaces captured edges without changing the node's ordinal; malformed edges or cycles reject. */
  setDependencies(id: string, dependencies: readonly ITopologyDependency[]): void
}>

/** Isolated working topology; every read and write rejects after either settlement operation. */
export type ITopologyTransaction = ITopologyIndexReader &
  ITopologyIndexWriter &
  Readonly<{
    /** Publishes the working changes to the base and permanently closes this transaction. */
    commit(): void
    /** Discards working changes, releases the base writer, and permanently closes this transaction. */
    rollback(): void
  }>

/** Mutable topology owner with one transaction writer at a time and stable base readers. */
export type ITopologyIndex = ITopologyIndexReader &
  ITopologyIndexWriter &
  Readonly<{
    /** Opens an isolated working view; base mutations and a second begin reject until settlement. */
    begin(): ITopologyTransaction
  }>

/** Mutable topology owner; all public values leave through frozen snapshots. */
class TopologyIndex implements ITopologyIndex {
  /** Caller-owned error policy retained for structural failures. */
  readonly #adapter: ITopologyIndexAdapter

  /** Nodes indexed by stable ID, including monotonic ordinal and current level. */
  readonly #nodes: IKeyedStore<string, IStoredTopologyNode>

  /** Requiredness keyed by provider and consumer, retaining dangling provider references. */
  readonly #consumers: IKeyedStore<string, IKeyedStore<string, boolean>>

  /** Next monotonic registration ordinal; removals never reclaim it. */
  #nextOrdinal: number

  /** Whether one isolated transaction currently owns mutation authority. */
  #transactionOpen = false

  /**
   * Creates an empty index, or — given `parent` — a transaction working view whose stores overlay
   * the parent's without copying them.
   */
  constructor(adapter: ITopologyIndexAdapter, parent?: TopologyIndex) {
    if (parent) this.#adapter = parent.#adapter
    else {
      /** Preserve the original frozen receiver snapshot while adding the captured-cause boundary. */
      const snapshot = Object.freeze({ ...adapter })
      this.#adapter = Object.freeze({
        onCycle: (path) => snapshot.onCycle(path),
        onInvalid: retainTopologyFailure((...args) => snapshot.onInvalid(...args))
      })
    }
    this.#nodes = parent ? new OverlayStore(parent.#nodes) : new Map()
    this.#consumers = parent ? new OverlayStore(parent.#consumers) : new Map()
    this.#nextOrdinal = parent ? parent.#nextOrdinal : 0
  }

  /** Number of currently present nodes. */
  get size(): number {
    return this.#nodes.size
  }

  /** Reports membership with one direct node lookup. */
  has(id: string): boolean {
    return this.#nodes.has(id)
  }

  /** Reads the existing monotonic registration fact without constructing a dense static snapshot. */
  registrationOrdinal(id: string): number {
    return this.#requireNode(id).ordinal
  }

  /** Returns the frozen dependency facts for one present node. */
  dependencies(id: string): readonly ITopologyDependency[] {
    /** Present immutable node facts are the sole source for this operation. */
    const node = this.#requireNode(id)
    return node.dependencies
  }

  /** Returns direct present dependents split by required and optional edge kind. */
  dependents(id: string): IGraphDependents {
    this.#requireNode(id)
    /** Required consumers in registration order. */
    const required: string[] = []
    /** Optional consumers in registration order. */
    const optional: string[] = []
    /** Reverse membership stays keyed; projection alone restores registration order. */
    const edges = this.#consumers.get(id)
    /** Captured consumers are restricted to this provider's direct neighbourhood. */
    const consumers: IStoredTopologyNode[] = []
    for (const consumer of edges?.keys() ?? []) consumers.push(this.#nodes.get(consumer)!)
    for (const consumer of registrationTopologyNodes(consumers)) {
      ;(edges!.get(consumer.id) ? required : optional).push(consumer.id)
    }
    return Object.freeze({
      required: Object.freeze(required),
      optional: Object.freeze(optional)
    })
  }

  /** Returns edges from one node to providers not currently present. */
  missing(id: string): readonly ITopologyDependency[] {
    /** Present immutable node facts are the sole source for this operation. */
    const node = this.#requireNode(id)
    /** Dangling edges retained in declaration order. */
    const missing: ITopologyDependency[] = []
    for (const dependency of node.dependencies) {
      if (!this.#nodes.has(dependency.provider)) missing.push(dependency)
    }
    return Object.freeze(missing)
  }

  /** Collects roots and all transitive required dependents in canonical order. */
  closure(roots: readonly string[]): readonly string[] {
    /** IDs reached through required reverse edges. */
    const reached = new Set<string>()
    /** Breadth-first work queue; final output uses bounded canonical buckets. */
    const queue: string[] = []
    for (const root of roots) {
      this.#requireNode(root)
      if (!reached.has(root)) {
        reached.add(root)
        queue.push(root)
      }
    }
    for (let index = 0; index < queue.length; index += 1) {
      /** Each reached provider expands its reverse memberships once. */
      const provider = queue[index]!
      for (const [consumerId, required] of this.#consumers.get(provider) ?? []) {
        if (!required || reached.has(consumerId)) continue
        reached.add(consumerId)
        queue.push(consumerId)
      }
    }
    return Object.freeze(this.#orderCanonical(reached))
  }

  /** Returns all nodes or one validated subset in canonical level/ordinal order. */
  order(ids?: Iterable<string>): readonly string[] {
    /** Requested IDs, deduplicated without changing their semantic set. */
    const selected = ids ? new Set(ids) : new Set(this.#nodes.keys())
    for (const id of selected) this.#requireNode(id)
    return Object.freeze(this.#orderCanonical(selected))
  }

  /** Produces a deeply frozen static topology projection with dense ordinals. */
  snapshot(): ICapabilityTopology {
    /** Present nodes in raw registration order for dense ordinal projection. */
    const ordinalNodes = registrationTopologyNodes(this.#nodes.values())
    /** Frozen public nodes keyed by ID. */
    const publicNodes = new Map<string, ITopologyNode>()
    for (let ordinal = 0; ordinal < ordinalNodes.length; ordinal += 1) {
      /** Registration position chooses the public dense ordinal independently of topology rank. */
      const node = ordinalNodes[ordinal]!
      publicNodes.set(
        node.id,
        Object.freeze({ id: node.id, dependencies: node.dependencies, ordinal })
      )
    }
    /** Provider-to-consumer entries preserving static-topology key order. */
    const providerEntries = new Map<string, ITopologyNode[]>()
    /** Consumer-to-provider entries preserving registration order. */
    const consumerEntries: Array<readonly [string, readonly ITopologyDependency[]]> = []
    /** Initial indegree entries preserving registration order. */
    const indegreeEntries: Array<readonly [string, number]> = []
    /** Level entries preserving registration order. */
    const levelEntries: Array<readonly [string, number]> = []
    /** Dense ordinal entries preserving registration order. */
    const ordinalEntries: Array<readonly [string, number]> = []
    for (let ordinal = 0; ordinal < ordinalNodes.length; ordinal += 1) {
      /** Registration position chooses the public dense ordinal independently of topology rank. */
      const node = ordinalNodes[ordinal]!
      consumerEntries.push([node.id, node.dependencies])
      /** Only dependencies whose providers remain present contribute indegree. */
      let indegree = 0
      for (const dependency of node.dependencies) {
        /** Public provider membership determines whether this edge participates in the snapshot. */
        const provider = publicNodes.get(dependency.provider)
        if (!provider) continue
        indegree += 1
        /** First consumer encounter determines the provider map's stable key order. */
        const consumers = providerEntries.get(dependency.provider)
        if (consumers) consumers.push(publicNodes.get(node.id)!)
        else providerEntries.set(dependency.provider, [publicNodes.get(node.id)!])
      }
      indegreeEntries.push([node.id, indegree])
      levelEntries.push([node.id, node.level])
      ordinalEntries.push([node.id, ordinal])
    }
    /** Public ordered nodes share the same immutable node instances as map values. */
    const ordered = Object.freeze(
      this.#orderCanonical(this.#nodes.keys()).map((id) => publicNodes.get(id)!)
    )
    return Object.freeze({
      ordered,
      providers: createTopologyReadonlyMap(
        [...providerEntries].map(([provider, consumers]) => [provider, Object.freeze(consumers)])
      ),
      consumers: createTopologyReadonlyMap(consumerEntries),
      indegree: createTopologyReadonlyMap(indegreeEntries),
      level: createTopologyReadonlyMap(levelEntries),
      ordinal: createTopologyReadonlyMap(ordinalEntries)
    })
  }

  /** Adds one node atomically and activates reverse-indexed dangling edges. */
  add(candidate: ITopologyIndexNode): void {
    this.#assertWritable()
    /** Admission captures hostile fields before any index mutation. */
    const node = snapshotTopologyIndexNode(candidate, (reason, id, failure) =>
      failure === undefined
        ? this.#adapter.onInvalid(reason, id)
        : this.#adapter.onInvalid(reason, id, failure)
    )
    this.#addSnapshot(node)
  }

  /** Adds a package-admitted immutable node without repeating public getter/edge admission. */
  #addSnapshot(node: ITopologyIndexNode): void {
    if (this.#nodes.has(node.id))
      this.#adapter.onInvalid(TopologyInvalidReason.duplicateNode, node.id)
    /** Existing incoming references become present-provider edges when this node is admitted. */
    const danglingConsumers = this.#consumers.get(node.id)
    if (
      node.dependencies.some((dependency) => dependency.provider === node.id) ||
      (danglingConsumers?.size ?? 0) > 0
    )
      this.#assertAcyclic(node.id, node.dependencies)

    this.#nodes.set(
      node.id,
      Object.freeze({
        id: node.id,
        ordinal: this.#nextOrdinal,
        level: 0,
        dependencies: node.dependencies
      })
    )
    this.#nextOrdinal += 1
    for (const dependency of node.dependencies)
      this.#addReverseEdge(dependency.provider, node.id, dependency.required)
    this.#recomputeLevels([node.id, ...(danglingConsumers?.keys() ?? [])])
  }

  /** Removes one node while retaining incoming edges as dangling reverse facts. */
  remove(id: string): void {
    this.#assertWritable()
    /** Present immutable node facts are the sole source for this operation. */
    const node = this.#requireNode(id)
    /** Present consumers whose level may fall after this provider disappears. */
    const affected = [...(this.#consumers.get(id)?.keys() ?? [])]
    for (const dependency of node.dependencies) {
      this.#removeReverseEdge(dependency.provider, id)
    }
    this.#nodes.delete(id)
    this.#recomputeLevels(affected)
  }

  /** Replaces one node's edge set atomically without changing its ordinal. */
  setDependencies(id: string, dependencies: readonly ITopologyDependency[]): void {
    this.#assertWritable()
    /** Present immutable node facts are the sole source for this operation. */
    const node = this.#requireNode(id)
    /** Frozen candidate edges replace the old facts only after structural validation succeeds. */
    const snapshots = snapshotTopologyDependencies(dependencies, id, (reason, nodeId, failure) =>
      failure === undefined
        ? this.#adapter.onInvalid(reason, nodeId)
        : this.#adapter.onInvalid(reason, nodeId, failure)
    )
    /** Newly introduced present providers that could close a back edge. */
    const oldProviders = new Set(node.dependencies.map((dependency) => dependency.provider))
    /** Existing lower-level providers cannot create a new backward dependency path. */
    const mightCycle = snapshots.some((dependency) => {
      if (oldProviders.has(dependency.provider)) return false
      if (dependency.provider === id) return true
      /** Current provider depth limits when cycle traversal is necessary. */
      const provider = this.#nodes.get(dependency.provider)
      return provider !== undefined && provider.level >= node.level
    })
    if (mightCycle) this.#assertAcyclic(id, snapshots)

    for (const dependency of node.dependencies)
      this.#removeReverseEdge(dependency.provider, node.id)
    for (const dependency of snapshots)
      this.#addReverseEdge(dependency.provider, node.id, dependency.required)
    this.#nodes.set(node.id, Object.freeze({ ...node, dependencies: snapshots }))
    this.#recomputeLevels([node.id])
  }

  /**
   * Opens one isolated transaction while base readers retain pre-transaction state. Opening costs
   * O(1); commit costs the keys the transaction wrote; rollback drops the overlay.
   */
  begin(): ITopologyTransaction {
    if (this.#transactionOpen) this.#adapter.onInvalid(TopologyInvalidReason.transactionOpen)
    this.#transactionOpen = true
    /** Working view whose stores overlay this index. */
    const working = new TopologyIndex(this.#adapter, this)
    return new TopologyTransaction(
      working,
      () => this.#adopt(working),
      () => this.#discard(),
      () => this.#adapter.onInvalid(TopologyInvalidReason.transactionClosed)
    )
  }

  /** Applies a transaction view's overlay writes, then releases ownership. */
  #adopt(working: TopologyIndex): void {
    ;(working.#nodes as OverlayStore<string, IStoredTopologyNode>).applyTo(this.#nodes)
    ;(working.#consumers as OverlayStore<string, IKeyedStore<string, boolean>>).applyTo(
      this.#consumers,
      (bucket) => (bucket instanceof OverlayStore ? bucket.commitToBase() : bucket)
    )
    this.#nextOrdinal = working.#nextOrdinal
    this.#transactionOpen = false
  }

  /** Drops a transaction view's writes and releases ownership. */
  #discard(): void {
    this.#transactionOpen = false
  }

  /** Rejects base mutation while a transaction owns the writer. */
  #assertWritable(): void {
    if (this.#transactionOpen) this.#adapter.onInvalid(TopologyInvalidReason.transactionOpen)
  }

  /** Returns one node or routes the unknown ID through the adapter. */
  #requireNode(id: string): IStoredTopologyNode {
    /** Missing identity delegates its native error policy to the caller adapter. */
    const node = this.#nodes.get(id)
    if (!node) this.#adapter.onInvalid(TopologyInvalidReason.unknownNode, id)
    return node
  }

  /**
   * Returns a writable consumer bucket without copying its existing memberships. A transaction adds
   * an O(1) nested overlay, preserving stable base readers until commit.
   */
  #writableConsumers(provider: string): IKeyedStore<string, boolean> | undefined {
    /** Existing provider bucket may still belong to the stable parent view. */
    const consumers = this.#consumers.get(provider)
    if (!consumers || !(this.#consumers instanceof OverlayStore) || this.#consumers.owns(provider))
      return consumers
    /** Nested overlay charges only actual consumer edits when the transaction commits. */
    const overlay = new OverlayStore(consumers)
    this.#consumers.set(provider, overlay)
    return overlay
  }

  /** Stores one reverse membership in O(1); readers own registration-order projection. */
  #addReverseEdge(provider: string, consumer: string, required: boolean): void {
    /** Writable bucket is owned either by this base or its transaction overlay. */
    const consumers = this.#writableConsumers(provider)
    if (consumers) consumers.set(consumer, required)
    else this.#consumers.set(provider, new Map([[consumer, required]]))
  }

  /** Removes one reverse edge and prunes empty provider buckets. */
  #removeReverseEdge(provider: string, consumer: string): void {
    /** Writable bucket is owned either by this base or its transaction overlay. */
    const consumers = this.#writableConsumers(provider)
    if (!consumers) return
    consumers.delete(consumer)
    if (consumers.size === 0) this.#consumers.delete(provider)
  }

  /** Rejects a candidate edge set when stable dependency traversal closes a cycle. */
  #assertAcyclic(id: string, dependencies: readonly ITopologyDependency[]): void {
    /** Active DFS path used to return a stable closed cycle. */
    const path: string[] = [id]
    /** Nodes on the active path, mapped to their path index. */
    const active = new Map<string, number>([[id, 0]])
    /** Nodes proven not to close a cycle back to the candidate. */
    const complete = new Set<string>()
    /** Iterative DFS frames avoid call-stack limits on large graphs. */
    const frames: Array<
      Readonly<{ id: string; dependencies: readonly ITopologyDependency[] }> & { index: number }
    > = [{ id, dependencies, index: 0 }]

    while (frames.length > 0) {
      /** Current DFS continuation resumes in declaration order after each provider. */
      const frame = frames[frames.length - 1]!
      /** Each candidate edge is inspected at most once per completed DFS frame. */
      const dependency = frame.dependencies[frame.index]
      frame.index += 1
      if (!dependency) {
        complete.add(frame.id)
        active.delete(frame.id)
        frames.pop()
        path.pop()
        continue
      }
      /** Provider identity either closes the active path or advances the DFS. */
      const provider = dependency.provider
      /** Active positions identify the stable closed suffix without rescanning the path. */
      const activeIndex = active.get(provider)
      if (activeIndex !== undefined) {
        this.#adapter.onCycle(Object.freeze([...path.slice(activeIndex), provider]))
      }
      if (complete.has(provider)) continue
      /** Absent providers remain dangling facts and do not participate in cycles. */
      const providerNode = provider === id ? undefined : this.#nodes.get(provider)
      if (!providerNode) continue
      active.set(provider, path.length)
      path.push(provider)
      frames.push({ id: provider, dependencies: providerNode.dependencies, index: 0 })
    }
  }

  /**
   * Propagates actual depth changes once per node in original-level order. Every existing provider
   * has a strictly lower original level than its consumer. The changed registration is seeded
   * before dangling consumers, so all changed providers settle first. Unchanged nodes stop
   * propagation; bounded integer buckets preserve affected-region cost.
   */
  #recomputeLevels(seeds: Iterable<string>): void {
    /** Original-level frontier is a graph derivation detail, not a lifecycle mutation queue. */
    const queue = new TopologyLevelQueue()
    /** A node enters the frontier once even when several providers change in this operation. */
    const queued = new Set<string>()
    for (const seed of seeds) {
      /** Removal may leave no present node at a seed identity. */
      const node = this.#nodes.get(seed)
      if (!node || queued.has(seed)) continue
      queued.add(seed)
      queue.push(seed, node.level)
    }
    while (queue.size > 0) {
      /** Original levels select provider-first propagation without revisiting a consumer. */
      const id = queue.take()!
      /** Current node facts retain original depth until this node's single evaluation. */
      const node = this.#nodes.get(id)!
      /** Longest present-provider path determines this node's final depth. */
      let level = 0
      for (const dependency of node.dependencies) {
        /** Changed providers already carry final depths; all other providers remain unchanged. */
        const provider = this.#nodes.get(dependency.provider)
        if (provider) level = Math.max(level, provider.level + 1)
      }
      if (level === node.level) continue
      this.#nodes.set(id, Object.freeze({ ...node, level }))
      for (const consumer of this.#consumers.get(id)?.keys() ?? []) {
        if (queued.has(consumer)) continue
        queued.add(consumer)
        queue.push(consumer, this.#nodes.get(consumer)!.level)
      }
    }
  }

  /** Places a validated subset into fixed-width level and ordinal buckets in O(subset size). */
  #orderCanonical(ids: Iterable<string>): string[] {
    /** Only selected facts enter the ordering owner; unrelated graph size is not consulted. */
    const nodes: IStoredTopologyNode[] = []
    for (const id of ids) nodes.push(this.#nodes.get(id)!)
    return orderTopologyNodes(nodes).map((node) => node.id)
  }
}

/**
 * Creates an empty incremental dependency index with required cycle/invalid-input adapters. Edits
 * update ordering and reverse adjacency without resource lifecycle effects. Readers return frozen
 * facts; missing providers are allowed and retained. Use begin for isolated multi-edit changes, and
 * always commit or roll back before editing the base again.
 */
export function createTopologyIndex(adapter: ITopologyIndexAdapter): ITopologyIndex {
  return new TopologyIndex(adapter)
}
