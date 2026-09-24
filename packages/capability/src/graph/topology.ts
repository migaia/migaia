import { createTopologyIndex } from './topology-index.js'

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

export type ITopologyInvalidReason =
  (typeof TopologyInvalidReason)[keyof typeof TopologyInvalidReason]

/** One provider edge consumed by the pure topology admission primitive. */
export type ITopologyDependency = {
  readonly provider: string
  readonly required: boolean
}

/** Minimal admitted node shape consumed by the static and future dynamic topology owners. */
export type ITopologyNode = {
  readonly id: string
  readonly dependencies: readonly ITopologyDependency[]
  /** Public registration ordinal; admitted nodes must cover each integer in [0, nodeCount). */
  readonly ordinal: number
}

/** Frozen topology snapshot shared by static Graph and future dynamic graph oracles. */
export type ICapabilityTopology = {
  readonly ordered: readonly ITopologyNode[]
  /** Provider-to-consumer facts retained for dynamic graph reuse. */
  readonly providers: ReadonlyMap<string, readonly ITopologyNode[]>
  /** Consumer-to-provider facts retained as the canonical edge snapshot. */
  readonly consumers: ReadonlyMap<string, readonly ITopologyDependency[]>
  /** Remaining dependency count at topology admission. */
  readonly indegree: ReadonlyMap<string, number>
  readonly level: ReadonlyMap<string, number>
  /** Registration ordinal for stable same-level scheduling. */
  readonly ordinal: ReadonlyMap<string, number>
}

/** Copies one hostile runtime node without rereading any public getter. */
function snapshotTopologyNode(
  candidate: unknown,
  nodeCount: number,
  onInvalid: (reason: ITopologyInvalidReason, nodeId?: string) => never
): ITopologyNode {
  if ((typeof candidate !== 'object' || candidate === null) && typeof candidate !== 'function')
    onInvalid(TopologyInvalidReason.invalidNode)
  const record = candidate as {
    readonly id?: unknown
    readonly ordinal?: unknown
    readonly dependencies?: unknown
  }
  let idValue: unknown
  let ordinalValue: unknown
  let dependenciesValue: unknown
  try {
    idValue = record.id
    ordinalValue = record.ordinal
    dependenciesValue = record.dependencies
  } catch {
    onInvalid(TopologyInvalidReason.invalidNode)
  }
  const nodeId = typeof idValue === 'string' ? idValue : undefined
  if (typeof idValue !== 'string' || idValue.length === 0)
    onInvalid(TopologyInvalidReason.invalidNode)
  if (
    !Number.isSafeInteger(ordinalValue) ||
    (ordinalValue as number) < 0 ||
    (ordinalValue as number) >= nodeCount
  )
    onInvalid(TopologyInvalidReason.invalidNode, nodeId)
  if (!Array.isArray(dependenciesValue)) onInvalid(TopologyInvalidReason.invalidNode, nodeId)
  const dependencyValues: unknown[] = dependenciesValue.slice()
  const edgeProviders = new Set<string>()
  const dependencies = dependencyValues.map((candidateDependency) => {
    if (
      (typeof candidateDependency !== 'object' || candidateDependency === null) &&
      typeof candidateDependency !== 'function'
    )
      onInvalid(TopologyInvalidReason.invalidNode, nodeId)
    const dependencyRecord = candidateDependency as {
      readonly provider?: unknown
      readonly required?: unknown
    }
    let providerValue: unknown
    let requiredValue: unknown
    try {
      providerValue = dependencyRecord.provider
      requiredValue = dependencyRecord.required
    } catch {
      onInvalid(TopologyInvalidReason.invalidNode, nodeId)
    }
    if (typeof providerValue !== 'string' || providerValue.length === 0)
      onInvalid(TopologyInvalidReason.invalidNode, nodeId)
    if (typeof requiredValue !== 'boolean') onInvalid(TopologyInvalidReason.invalidNode, nodeId)
    if (edgeProviders.has(providerValue)) onInvalid(TopologyInvalidReason.duplicateEdge, nodeId)
    edgeProviders.add(providerValue)
    return Object.freeze({ provider: providerValue, required: requiredValue })
  })
  return Object.freeze({
    id: idValue,
    dependencies: Object.freeze(dependencies),
    ordinal: ordinalValue as number
  })
}

/** Copies and validates all public node and required-edge facts before graph traversal. */
function snapshotTopologyNodes(
  nodes: readonly ITopologyNode[],
  onInvalid: (reason: ITopologyInvalidReason, nodeId?: string) => never
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

/** Builds provider adjacency, levels, and a deterministic schedule from one pure snapshot. */
export function buildCapabilityTopology(
  nodes: readonly ITopologyNode[],
  onUnknownProvider: (nodeId: string, provider: string) => never,
  onCycle: (path: readonly string[]) => never,
  onInvalid: (reason: ITopologyInvalidReason, nodeId?: string) => never
): ICapabilityTopology {
  const snapshots = snapshotTopologyNodes(nodes, onInvalid)
  /** IDs admitted by the hostile-input snapshot. */
  const nodeIds = new Set(snapshots.map((node) => node.id))
  for (const node of snapshots) {
    for (const edge of node.dependencies) {
      if (edge.required && !nodeIds.has(edge.provider)) onUnknownProvider(node.id, edge.provider)
    }
  }
  /** Temporary index centralizes adjacency, level, ordering, and cycle semantics. */
  const ordinalById = new Map(snapshots.map((node) => [node.id, node.ordinal]))
  const index = createTopologyIndex({
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
    onInvalid
  })
  for (const node of [...snapshots].sort((left, right) => left.ordinal - right.ordinal))
    index.add({
      id: node.id,
      dependencies: node.dependencies
    })
  return index.snapshot()
}

export {
  createTopologyIndex,
  type IGraphDependents,
  type ITopologyIndex,
  type ITopologyIndexAdapter,
  type ITopologyIndexMetrics,
  type ITopologyIndexNode,
  type ITopologyIndexReader,
  type ITopologyIndexWriter,
  type ITopologyTransaction
} from './topology-index.js'
