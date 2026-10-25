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

type IStoredTopologyNode = Readonly<{
  readonly id: string
  readonly ordinal: number
  readonly level: number
  readonly dependencies: readonly ITopologyDependency[]
}>

/** The keyed-store subset the index uses, satisfied by a `Map` and by a transaction overlay. */
type IKeyedStore<K, V> = {
  readonly size: number
  get(key: K): V | undefined
  has(key: K): boolean
  set(key: K, value: V): unknown
  delete(key: K): boolean
  keys(): IterableIterator<K>
  values(): IterableIterator<V>
}

/** Marks a key an overlay removed from its base store. */
const REMOVED: unique symbol = Symbol('topology-index.removed')

/**
 * Copy-on-write view over a base store: reads fall through to the base, writes stay in the overlay.
 * Opening it costs nothing and committing it costs the number of keys written, which keeps a
 * transaction proportional to the change instead of to the whole index.
 */
class OverlayStore<K, V> implements IKeyedStore<K, V> {
  /** Store observed until this overlay is committed; never written by the overlay. */
  readonly #base: IKeyedStore<K, V>
  /** Keys written in this overlay: a replacement value or the removal marker. */
  readonly #own = new Map<K, V | typeof REMOVED>()
  /** Merged-view size, maintained on every write so `size` stays O(1). */
  #size: number

  /** Wraps `base` without copying it. */
  constructor(base: IKeyedStore<K, V>) {
    this.#base = base
    this.#size = base.size
  }

  /** Number of keys in the merged view. */
  get size(): number {
    return this.#size
  }

  /** Reads the overlay value, falling back to the base for untouched keys. */
  get(key: K): V | undefined {
    if (!this.#own.has(key)) return this.#base.get(key)
    const own = this.#own.get(key)
    return own === REMOVED ? undefined : own
  }

  /** Reports membership in the merged view. */
  has(key: K): boolean {
    if (this.#own.has(key)) return this.#own.get(key) !== REMOVED
    return this.#base.has(key)
  }

  /** Whether `key` was written by this overlay (its value is not shared with the base). */
  owns(key: K): boolean {
    return this.#own.has(key) && this.#own.get(key) !== REMOVED
  }

  /** Writes one value into the overlay. */
  set(key: K, value: V): this {
    if (!this.has(key)) this.#size += 1
    this.#own.set(key, value)
    return this
  }

  /** Removes one key from the merged view. */
  delete(key: K): boolean {
    if (!this.has(key)) return false
    this.#size -= 1
    this.#own.set(key, REMOVED)
    return true
  }

  /** Iterates merged keys: untouched base keys first, then keys the overlay added. */
  *keys(): IterableIterator<K> {
    for (const key of this.#base.keys()) if (this.has(key)) yield key
    for (const [key, value] of this.#own) if (value !== REMOVED && !this.#base.has(key)) yield key
  }

  /** Iterates merged values in `keys()` order. */
  *values(): IterableIterator<V> {
    for (const key of this.keys()) yield this.get(key)!
  }

  /** Applies every overlay write to `target`; costs the number of written keys. */
  applyTo(target: IKeyedStore<K, V>): void {
    for (const [key, value] of this.#own)
      if (value === REMOVED) target.delete(key)
      else target.set(key, value)
  }
}

/** Mutable topology owner; all public values leave through frozen snapshots. */
class TopologyIndex implements ITopologyIndex {
  /** Caller-owned error policy retained for structural failures. */
  readonly #adapter: ITopologyIndexAdapter

  /** Nodes indexed by stable ID, including monotonic ordinal and current level. */
  readonly #nodes: IKeyedStore<string, IStoredTopologyNode>

  /** Requiredness indexed by consumer in registration order, including dangling provider IDs. */
  readonly #consumers: IKeyedStore<string, Map<string, boolean>>

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
    for (const [consumerId, requiredEdge] of this.#consumers.get(id) ?? []) {
      ;(requiredEdge ? required : optional).push(consumerId)
    }
    return Object.freeze({
      required: Object.freeze(required),
      optional: Object.freeze(optional)
    })
  }

  /** Returns edges from one node to providers not currently present. */
  missing(id: string): readonly ITopologyDependency[] {
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
    /** Breadth-first work queue; final output is sorted independently. */
    const queue: string[] = []
    for (const root of roots) {
      this.#requireNode(root)
      if (!reached.has(root)) {
        reached.add(root)
        queue.push(root)
      }
    }
    for (let index = 0; index < queue.length; index += 1) {
      const provider = queue[index]!
      for (const [consumerId, required] of this.#consumers.get(provider) ?? []) {
        if (!required || reached.has(consumerId)) continue
        reached.add(consumerId)
        queue.push(consumerId)
      }
    }
    return Object.freeze(this.#sortCanonical(reached))
  }

  /** Returns all nodes or one validated subset in canonical level/ordinal order. */
  order(ids?: Iterable<string>): readonly string[] {
    /** Requested IDs, deduplicated without changing their semantic set. */
    const selected = ids ? new Set(ids) : new Set(this.#nodes.keys())
    for (const id of selected) this.#requireNode(id)
    return Object.freeze(this.#sortCanonical(selected))
  }

  /** Produces a deeply frozen static topology projection with dense ordinals. */
  snapshot(): ICapabilityTopology {
    /** Present nodes in raw registration order for dense ordinal projection. */
    const ordinalNodes = [...this.#nodes.values()].sort(
      (left, right) => left.ordinal - right.ordinal
    )
    /** Frozen public nodes keyed by ID. */
    const publicNodes = new Map<string, ITopologyNode>()
    for (let ordinal = 0; ordinal < ordinalNodes.length; ordinal += 1) {
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
      const node = ordinalNodes[ordinal]!
      consumerEntries.push([node.id, node.dependencies])
      let indegree = 0
      for (const dependency of node.dependencies) {
        const provider = publicNodes.get(dependency.provider)
        if (!provider) continue
        indegree += 1
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
      this.#sortCanonical(this.#nodes.keys()).map((id) => publicNodes.get(id)!)
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
    const node = this.#requireNode(id)
    const snapshots = snapshotTopologyDependencies(dependencies, id, (reason, nodeId, failure) =>
      failure === undefined
        ? this.#adapter.onInvalid(reason, nodeId)
        : this.#adapter.onInvalid(reason, nodeId, failure)
    )
    /** Newly introduced present providers that could close a back edge. */
    const oldProviders = new Set(node.dependencies.map((dependency) => dependency.provider))
    const mightCycle = snapshots.some((dependency) => {
      if (oldProviders.has(dependency.provider)) return false
      if (dependency.provider === id) return true
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
    ;(working.#consumers as OverlayStore<string, Map<string, boolean>>).applyTo(this.#consumers)
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
    const node = this.#nodes.get(id)
    if (!node) this.#adapter.onInvalid(TopologyInvalidReason.unknownNode, id)
    return node
  }

  /**
   * Returns the consumer map of `provider` that this view may mutate. In a transaction view a map
   * still shared with the base is copied first, so base readers never observe transaction edges.
   */
  #writableConsumers(provider: string): Map<string, boolean> | undefined {
    const consumers = this.#consumers.get(provider)
    if (!consumers || !(this.#consumers instanceof OverlayStore) || this.#consumers.owns(provider))
      return consumers
    /** Transaction-owned copy of a base bucket. */
    const copy = new Map(consumers)
    this.#consumers.set(provider, copy)
    return copy
  }

  /** Stores edge kind once and maintains registration order when an old consumer is rewired. */
  #addReverseEdge(provider: string, consumer: string, required: boolean): void {
    /** Transaction-owned provider bucket; new nodes append in monotonic ordinal order. */
    const consumers = this.#writableConsumers(provider)
    if (!consumers) {
      this.#consumers.set(provider, new Map([[consumer, required]]))
      return
    }
    consumers.set(consumer, required)
    if (this.#nodes.get(consumer)!.ordinal === this.#nextOrdinal - 1) return
    // Existing consumers may regain an edge after newer registrations. Restore order on this
    // write so every reverse read can iterate directly without copying, sorting or edge lookup.
    this.#consumers.set(
      provider,
      new Map(
        [...consumers].sort(
          ([left], [right]) => this.#nodes.get(left)!.ordinal - this.#nodes.get(right)!.ordinal
        )
      )
    )
  }

  /** Removes one reverse edge and prunes empty provider buckets. */
  #removeReverseEdge(provider: string, consumer: string): void {
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
      const frame = frames[frames.length - 1]!
      const dependency = frame.dependencies[frame.index]
      frame.index += 1
      if (!dependency) {
        complete.add(frame.id)
        active.delete(frame.id)
        frames.pop()
        path.pop()
        continue
      }
      const provider = dependency.provider
      const activeIndex = active.get(provider)
      if (activeIndex !== undefined) {
        this.#adapter.onCycle(Object.freeze([...path.slice(activeIndex), provider]))
      }
      if (complete.has(provider)) continue
      const providerNode = provider === id ? undefined : this.#nodes.get(provider)
      if (!providerNode) continue
      active.set(provider, path.length)
      path.push(provider)
      frames.push({ id: provider, dependencies: providerNode.dependencies, index: 0 })
    }
  }

  /** Recomputes changed levels and propagates only through affected consumers. */
  #recomputeLevels(seeds: Iterable<string>): void {
    /** Deduplicated propagation queue. */
    const queue: string[] = []
    /** IDs already waiting for recomputation. */
    const queued = new Set<string>()
    for (const seed of seeds) {
      if (!this.#nodes.has(seed) || queued.has(seed)) continue
      queued.add(seed)
      queue.push(seed)
    }
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index]!
      queued.delete(id)
      const node = this.#nodes.get(id)
      if (!node) continue
      let level = 0
      for (const dependency of node.dependencies) {
        const provider = this.#nodes.get(dependency.provider)
        if (provider) level = Math.max(level, provider.level + 1)
      }
      if (level === node.level) continue
      this.#nodes.set(id, Object.freeze({ ...node, level }))
      for (const consumer of this.#consumers.get(id)?.keys() ?? []) {
        if (queued.has(consumer)) continue
        queued.add(consumer)
        queue.push(consumer)
      }
    }
  }

  /** Sorts a validated ID set by canonical level and registration ordinal. */
  #sortCanonical(ids: Iterable<string>): string[] {
    return [...ids].sort((left, right) => {
      const leftNode = this.#nodes.get(left)!
      const rightNode = this.#nodes.get(right)!
      return leftNode.level - rightNode.level || leftNode.ordinal - rightNode.ordinal
    })
  }
}

/** Transaction facade that invalidates every operation after settlement. */
class TopologyTransaction implements ITopologyTransaction {
  /** Overlay index used by transaction reads and writes. */
  readonly #working: TopologyIndex

  /** Parent-owned commit: applies the overlay and releases the parent's writer. */
  readonly #commit: () => void

  /** Parent-owned rollback: releases the parent's writer and drops the overlay. */
  readonly #rollback: () => void

  /** Parent-owned rejection for any use after settlement. */
  readonly #rejectClosed: () => never

  /** Whether commit or rollback has permanently settled this transaction. */
  #closed = false

  /**
   * Creates a transaction over one overlay view. The parent passes its authority as closures, so no
   * commit or rollback entry point exists on the index object itself.
   */
  constructor(
    working: TopologyIndex,
    commit: () => void,
    rollback: () => void,
    rejectClosed: () => never
  ) {
    this.#working = working
    this.#commit = commit
    this.#rollback = rollback
    this.#rejectClosed = rejectClosed
  }

  /** Number of nodes in the transaction view. */
  get size(): number {
    this.#assertOpen()
    return this.#working.size
  }

  /** Delegates membership reads to the transaction view. */
  has(id: string): boolean {
    this.#assertOpen()
    return this.#working.has(id)
  }

  /** Reads the transaction's canonical ordinal while enforcing its existing closed guard. */
  registrationOrdinal(id: string): number {
    this.#assertOpen()
    return this.#working.registrationOrdinal(id)
  }

  /** Delegates dependency reads to the transaction view. */
  dependencies(id: string): readonly ITopologyDependency[] {
    this.#assertOpen()
    return this.#working.dependencies(id)
  }

  /** Delegates dependent reads to the transaction view. */
  dependents(id: string): IGraphDependents {
    this.#assertOpen()
    return this.#working.dependents(id)
  }

  /** Delegates dangling-edge reads to the transaction view. */
  missing(id: string): readonly ITopologyDependency[] {
    this.#assertOpen()
    return this.#working.missing(id)
  }

  /** Delegates closure reads to the transaction view. */
  closure(roots: readonly string[]): readonly string[] {
    this.#assertOpen()
    return this.#working.closure(roots)
  }

  /** Delegates ordering reads to the transaction view. */
  order(ids?: Iterable<string>): readonly string[] {
    this.#assertOpen()
    return this.#working.order(ids)
  }

  /** Delegates snapshot reads to the transaction view. */
  snapshot(): ICapabilityTopology {
    this.#assertOpen()
    return this.#working.snapshot()
  }

  /** Adds a node only to the transaction view. */
  add(node: ITopologyIndexNode): void {
    this.#assertOpen()
    this.#working.add(node)
  }

  /** Removes a node only from the transaction view. */
  remove(id: string): void {
    this.#assertOpen()
    this.#working.remove(id)
  }

  /** Replaces dependencies only in the transaction view. */
  setDependencies(id: string, dependencies: readonly ITopologyDependency[]): void {
    this.#assertOpen()
    this.#working.setDependencies(id, dependencies)
  }

  /** Publishes all isolated changes atomically and closes the transaction. */
  commit(): void {
    this.#assertOpen()
    this.#commit()
    this.#closed = true
  }

  /** Discards all isolated changes and closes the transaction. */
  rollback(): void {
    this.#assertOpen()
    this.#rollback()
    this.#closed = true
  }

  /** Rejects every operation after transaction settlement. */
  #assertOpen(): void {
    if (this.#closed) this.#rejectClosed()
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
