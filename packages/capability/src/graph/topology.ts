import { createTopologyIndexFromSnapshots } from './topology-index.js'
import {
  admitTopologyId,
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
  /** Temporary index centralizes adjacency, level, ordering, and cycle semantics. */
  const ordinalById = new Map(snapshots.map((node) => [node.id, node.ordinal]))
  const index = createTopologyIndexFromSnapshots(
    {
      onCycle: (path) => {
        /** Open cycle nodes rotated to the legacy static projection's lowest ordinal. */
        const cycle = path.slice(0, -1)
        if (cycle.length === 0) return onCycle(path)
        let start = 0
        for (let index = 1; index < cycle.length; index += 1) {
          if ((ordinalById.get(cycle[index]!) ?? 0) < (ordinalById.get(cycle[start]!) ?? 0))
            start = index
        }
        const normalized = [...cycle.slice(start), ...cycle.slice(0, start)]
        return onCycle(Object.freeze([...normalized, normalized[0]!]))
      },
      onInvalid: invalid
    },
    [...snapshots].sort((left, right) => left.ordinal - right.ordinal)
  )
  return index.snapshot()
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
