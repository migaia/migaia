import {
  admitTopologyId,
  createTopologyReadonlyMap,
  isTopologyRecord,
  snapshotTopologyDependencies,
  retainTopologyFailure,
  type ITopologySnapshotFailure
} from './topology-admission.js'

/** Stable structural reasons passed to the caller-owned topology error adapter. */
export const TopologyInvalidReason = {
  /** A node descriptor is structurally invalid. */
  invalidNode: 'invalid-node',
  /** Two node descriptors use the same ID. */
  duplicateNode: 'duplicate-node',
  /** A node repeats one required provider edge. */
  duplicateEdge: 'duplicate-edge',
  /** Two node descriptors use the same registration ordinal. */
  duplicateOrdinal: 'duplicate-ordinal',
  /** A topology operation references a node that is not currently present. */
  unknownNode: 'unknown-node',
  /** A nested transaction or base-index mutation is attempted while a transaction is open. */
  transactionOpen: 'transaction-open',
  /** A settled transaction is used after commit or rollback. */
  transactionClosed: 'transaction-closed'
} as const

/** Structural admission and transaction-state failures interpreted by the caller's error adapter. */
export type ITopologyInvalidReason =
  (typeof TopologyInvalidReason)[keyof typeof TopologyInvalidReason]

/** One provider edge consumed by the pure topology admission primitive. */
export type ITopologyDependency = {
  /** Nonempty provider ID; a missing optional provider is permitted. */
  readonly provider: string
  /** Required edges reject absent providers in the static builder and drive dependent closure. */
  readonly required: boolean
}

/** Minimal admitted node shape consumed by the static and incremental topology owners. */
export type ITopologyNode = {
  /** Unique nonempty identity captured before topology traversal. */
  readonly id: string
  /** Ordered edge snapshot; duplicate providers are rejected even if requiredness differs. */
  readonly dependencies: readonly ITopologyDependency[]
  /** Public registration ordinal; admitted nodes must cover each integer in [0, nodeCount). */
  readonly ordinal: number
}

/** Frozen topology snapshot shared by static Graph and incremental topology projections. */
export type ICapabilityTopology = {
  /** Frozen node snapshots in ascending dependency level, then registration ordinal. */
  readonly ordered: readonly ITopologyNode[]
  /** Provider-to-consumer facts retained for dynamic graph reuse. */
  readonly providers: ReadonlyMap<string, readonly ITopologyNode[]>
  /** Consumer-to-provider facts retained as the canonical edge snapshot. */
  readonly consumers: ReadonlyMap<string, readonly ITopologyDependency[]>
  /** Count of edges to present providers at admission, before traversal; includes optional edges. */
  readonly indegree: ReadonlyMap<string, number>
  /** Longest present-provider path depth, with independent nodes at zero. */
  readonly level: ReadonlyMap<string, number>
  /** Dense registration ordinal for stable same-level scheduling in this snapshot. */
  readonly ordinal: ReadonlyMap<string, number>
}

/** Copies one hostile runtime node without rereading any public getter. */
function snapshotTopologyNode(
  candidate: unknown,
  nodeCount: number,
  onInvalid: ITopologySnapshotFailure
): ITopologyNode {
  if (!isTopologyRecord(candidate)) onInvalid(TopologyInvalidReason.invalidNode)
  /** Static projection captures all three caller fields before validating their values. */
  const record = candidate as {
    readonly id?: unknown
    readonly ordinal?: unknown
    readonly dependencies?: unknown
  }
  /** One captured public node identity. */
  let idValue: unknown
  /** Static inputs own a dense registration ordinal, unlike incremental index inputs. */
  let ordinalValue: unknown
  /** Caller-owned edge list captured before traversing any dependency getter. */
  let dependenciesValue: unknown
  try {
    idValue = record.id
    ordinalValue = record.ordinal
    dependenciesValue = record.dependencies
  } catch (cause) {
    onInvalid(TopologyInvalidReason.invalidNode, undefined, { cause })
  }
  /** ID validation is shared while this leaf retains its existing invalid-ID diagnostic shape. */
  const nodeId = admitTopologyId(idValue, (reason) => onInvalid(reason))
  if (
    !Number.isSafeInteger(ordinalValue) ||
    (ordinalValue as number) < 0 ||
    (ordinalValue as number) >= nodeCount
  )
    onInvalid(TopologyInvalidReason.invalidNode, nodeId)
  /** Canonical edge admission supplies the frozen dependency snapshot once. */
  const dependencies = snapshotTopologyDependencies(dependenciesValue, nodeId, onInvalid)
  return Object.freeze({
    id: nodeId,
    dependencies,
    ordinal: ordinalValue as number
  })
}

/** Copies and validates all public node and required-edge facts before graph traversal. */
function snapshotTopologyNodes(
  nodes: readonly ITopologyNode[],
  onInvalid: ITopologySnapshotFailure
): readonly ITopologyNode[] {
  if (!Array.isArray(nodes)) onInvalid(TopologyInvalidReason.invalidNode)
  const candidates: unknown[] = nodes.slice() as unknown[]
  const ids = new Set<string>()
  const ordinals = new Set<number>()
  const snapshots: ITopologyNode[] = []
  for (const candidate of candidates) {
    const node = snapshotTopologyNode(candidate, candidates.length, onInvalid)
    const id = node.id
    const ordinal = node.ordinal
    if (ids.has(id)) onInvalid(TopologyInvalidReason.duplicateNode, id)
    if (ordinals.has(ordinal)) onInvalid(TopologyInvalidReason.duplicateOrdinal, id)
    ids.add(id)
    ordinals.add(ordinal)
    snapshots.push(node)
  }
  return Object.freeze(snapshots)
}

/**
 * Copies node and edge facts into a frozen dependency schedule without starting or releasing any
 * resource. Nodes need unique IDs and ordinals covering zero through nodeCount minus one. Present
 * edges, including optional edges, affect levels and cycle checks; only required missing providers
 * invoke onUnknownProvider. onCycle receives a frozen closed path, and onInvalid handles malformed
 * facts with captured getter causes retained. All four arguments are required; adapters own
 * errors.
 */
export function buildCapabilityTopology(
  nodes: readonly ITopologyNode[],
  onUnknownProvider: (nodeId: string, provider: string) => never,
  onCycle: (path: readonly string[]) => never,
  onInvalid: ITopologySnapshotFailure
): ICapabilityTopology {
  /** Caller policy selects the shell; the shared admission boundary keeps captured causes reachable. */
  const invalid = retainTopologyFailure(onInvalid)
  const snapshots = snapshotTopologyNodes(nodes, invalid)
  /** IDs admitted by the hostile-input snapshot. */
  const nodeIds = new Set(snapshots.map((node) => node.id))
  for (const node of snapshots) {
    for (const edge of node.dependencies) {
      if (edge.required && !nodeIds.has(edge.provider)) onUnknownProvider(node.id, edge.provider)
    }
  }
  /** Dense ordinals provide stable placement without comparison sorting. */
  const ordinalNodes: ITopologyNode[] = []
  /** Canonical captured nodes keyed by identity for constant-time edge lookup. */
  const byId = new Map<string, ITopologyNode>()
  for (const node of snapshots) {
    ordinalNodes[node.ordinal] = node
    byId.set(node.id, node)
  }
  /** Completed nodes retain longest provider-path depth. */
  const levels = new Map<string, number>()
  /** Active DFS positions identify the first closed cycle in ordinal/declaration order. */
  const active = new Map<string, number>()
  /** Iterative traversal avoids host call-stack limits on long Feature chains. */
  const frames: Array<{ readonly node: ITopologyNode; edge: number; level: number }> = []
  for (const root of ordinalNodes) {
    if (levels.has(root.id)) continue
    active.set(root.id, 0)
    frames.push({ node: root, edge: 0, level: 0 })
    while (frames.length > 0) {
      /** Current continuation resumes after its next provider completes. */
      const frame = frames[frames.length - 1]!
      /** Each dependency advances once after its provider depth is known. */
      const edge = frame.node.dependencies[frame.edge]
      if (edge) {
        /** Missing optional providers do not add a scheduling edge. */
        const provider = byId.get(edge.provider)
        if (!provider) {
          frame.edge += 1
          continue
        }
        /** A provider already on this path closes the first deterministic cycle. */
        const activeIndex = active.get(provider.id)
        if (activeIndex !== undefined)
          onCycle(
            Object.freeze([...frames.slice(activeIndex).map((entry) => entry.node.id), provider.id])
          )
        /** Completed provider depth is reused across shared dependencies. */
        const providerLevel = levels.get(provider.id)
        if (providerLevel === undefined) {
          active.set(provider.id, frames.length)
          frames.push({ node: provider, edge: 0, level: 0 })
          continue
        }
        frame.level = Math.max(frame.level, providerLevel + 1)
        frame.edge += 1
        continue
      }
      levels.set(frame.node.id, frame.level)
      active.delete(frame.node.id)
      frames.pop()
    }
  }
  /** Level buckets retain ordinal order because nodes enter them in ordinal order. */
  const buckets: ITopologyNode[][] = []
  /** Provider keys follow the first referencing consumer in registration order. */
  const providers = new Map<string, ITopologyNode[]>()
  /** Every consumer keeps its captured dependency array, including absent optional providers. */
  const consumers: Array<readonly [string, readonly ITopologyDependency[]]> = []
  /** Counts only edges whose provider is present, before traversal. */
  const indegree: Array<readonly [string, number]> = []
  /** Public maps retain registration order independently of DFS completion order. */
  const levelEntries: Array<readonly [string, number]> = []
  /** Public ordinals retain the caller's admitted dense registration positions. */
  const ordinals: Array<readonly [string, number]> = []
  for (const node of ordinalNodes) {
    /** Precomputed depth chooses the bucket without comparison sorting. */
    const level = levels.get(node.id)!
    ;(buckets[level] ??= []).push(node)
    consumers.push([node.id, node.dependencies])
    levelEntries.push([node.id, level])
    ordinals.push([node.id, node.ordinal])
    /** Original indegree includes every edge to a present provider. */
    let present = 0
    for (const edge of node.dependencies) {
      if (!byId.has(edge.provider)) continue
      present += 1
      /** Existing provider bucket preserves consumer registration order. */
      const bucket = providers.get(edge.provider)
      if (bucket) bucket.push(node)
      else providers.set(edge.provider, [node])
    }
    indegree.push([node.id, present])
  }
  /** Flattening at most one bucket per node keeps scheduling linear. */
  const ordered: ITopologyNode[] = []
  for (const bucket of buckets) if (bucket) for (const node of bucket) ordered.push(node)
  return Object.freeze({
    ordered: Object.freeze(ordered),
    providers: createTopologyReadonlyMap(
      [...providers].map(([id, entries]) => [id, Object.freeze(entries)])
    ),
    consumers: createTopologyReadonlyMap(consumers),
    indegree: createTopologyReadonlyMap(indegree),
    level: createTopologyReadonlyMap(levelEntries),
    ordinal: createTopologyReadonlyMap(ordinals)
  })
}

export {
  createTopologyIndex,
  type IGraphDependents,
  type ITopologyIndex,
  type ITopologyIndexAdapter,
  type ITopologyIndexNode,
  type ITopologyIndexReader,
  type ITopologyIndexWriter,
  type ITopologyTransaction
} from './topology-index.js'
