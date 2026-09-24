/** Stable structural reasons passed to the caller-owned topology error adapter. */
export const TopologyInvalidReason = {
  /** A node descriptor is structurally invalid. */
  invalidNode: 'invalid-node',
  /** Two node descriptors use the same ID. */
  duplicateNode: 'duplicate-node',
  /** A node repeats one required provider edge. */
  duplicateEdge: 'duplicate-edge',
  /** Two node descriptors use the same registration ordinal. */
  duplicateOrdinal: 'duplicate-ordinal'
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

/** Creates a mutation-incapable map facade over an immutable entry snapshot. */
function createReadonlyMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
  const lookup = new Map(entries)
  const facade = {
    get: (key: K): V | undefined => lookup.get(key),
    has: (key: K): boolean => lookup.has(key),
    get size(): number {
      return lookup.size
    },
    entries: (): MapIterator<[K, V]> => lookup.entries(),
    keys: (): MapIterator<K> => lookup.keys(),
    values: (): MapIterator<V> => lookup.values(),
    forEach: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void => {
      for (const [key, value] of lookup) callback(value, key, facade)
    },
    [Symbol.iterator]: (): MapIterator<[K, V]> => lookup[Symbol.iterator]()
  } as ReadonlyMap<K, V>
  return Object.freeze(facade)
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

/** Finds one stable closed cycle path inside Kahn's residual graph. */
function findStableCyclePath(
  nodes: readonly ITopologyNode[],
  residualIndegree: ReadonlyMap<string, number>
): readonly string[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const residual = new Set(
    nodes.filter((node) => (residualIndegree.get(node.id) ?? 0) > 0).map((node) => node.id)
  )
  const colors = new Map<string, 'gray' | 'black'>()
  for (const root of nodes) {
    if (!residual.has(root.id) || colors.has(root.id)) continue
    const path: string[] = [root.id]
    const frames: Array<{ readonly node: ITopologyNode; index: number }> = [
      { node: root, index: 0 }
    ]
    colors.set(root.id, 'gray')
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!
      const dependency = frame.node.dependencies[frame.index]
      frame.index += 1
      if (!dependency) {
        colors.set(frame.node.id, 'black')
        frames.pop()
        path.pop()
        continue
      }
      if (!residual.has(dependency.provider)) continue
      const color = colors.get(dependency.provider)
      if (color === 'gray') {
        const start = path.indexOf(dependency.provider)
        return Object.freeze([...path.slice(start), dependency.provider])
      }
      if (color === 'black') continue
      const next = nodesById.get(dependency.provider)
      if (!next) continue
      colors.set(next.id, 'gray')
      path.push(next.id)
      frames.push({ node: next, index: 0 })
    }
  }
  return Object.freeze([])
}

/** Builds provider adjacency, levels, and a deterministic schedule from one pure snapshot. */
export function buildCapabilityTopology(
  nodes: readonly ITopologyNode[],
  onUnknownProvider: (nodeId: string, provider: string) => never,
  onCycle: (path: readonly string[]) => never,
  onInvalid: (reason: ITopologyInvalidReason, nodeId?: string) => never
): ICapabilityTopology {
  const snapshots = snapshotTopologyNodes(nodes, onInvalid)
  /** Direct ordinal placement keeps the admitted schedule linear after validation. */
  const ordinalOrder: ITopologyNode[] = []
  ordinalOrder.length = snapshots.length
  for (const node of snapshots) ordinalOrder[node.ordinal] = node
  /** Node lookup used by admission and residual-cycle traversal. */
  const nodesById = new Map(snapshots.map((node) => [node.id, node]))
  /** Reverse adjacency retained as reusable provider-to-consumer facts. */
  const consumersByProvider = new Map<string, ITopologyNode[]>()
  /** Forward dependency facts retained as the canonical edge snapshot. */
  const providersByConsumer = new Map<string, readonly ITopologyDependency[]>()
  for (const node of snapshots) {
    providersByConsumer.set(node.id, node.dependencies)
    for (const edge of node.dependencies) {
      if (!nodesById.has(edge.provider)) {
        if (edge.required) onUnknownProvider(node.id, edge.provider)
        continue
      }
      const consumers = consumersByProvider.get(edge.provider)
      if (consumers) consumers.push(node)
      else consumersByProvider.set(edge.provider, [node])
    }
  }
  /** Mutable Kahn cursor; all returned facts are copied behind read-only facades. */
  const indegree = new Map(
    snapshots.map((node) => [
      node.id,
      node.dependencies.filter((dependency) => nodesById.has(dependency.provider)).length
    ])
  )
  const initialIndegree = new Map(indegree)
  const level = new Map(snapshots.map((node) => [node.id, 0]))
  const queue = ordinalOrder.filter((node) => indegree.get(node.id) === 0)
  const topological: ITopologyNode[] = []
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    topological.push(current)
    for (const consumer of consumersByProvider.get(current.id) ?? []) {
      level.set(
        consumer.id,
        Math.max(level.get(consumer.id) ?? 0, (level.get(current.id) ?? 0) + 1)
      )
      const nextDegree = (indegree.get(consumer.id) ?? 0) - 1
      indegree.set(consumer.id, nextDegree)
      if (nextDegree === 0) queue.push(consumer)
    }
  }
  if (topological.length !== snapshots.length) onCycle(findStableCyclePath(ordinalOrder, indegree))
  const layers: ITopologyNode[][] = []
  for (const node of ordinalOrder) (layers[level.get(node.id) ?? 0] ??= []).push(node)
  const ordered = Object.freeze(layers.flatMap((layer) => Object.freeze(layer)))
  return Object.freeze({
    ordered,
    providers: createReadonlyMap(
      [...consumersByProvider.entries()].map(([provider, consumers]) => [
        provider,
        Object.freeze([...consumers])
      ])
    ),
    consumers: createReadonlyMap([...providersByConsumer.entries()]),
    indegree: createReadonlyMap([...initialIndegree.entries()]),
    level: createReadonlyMap([...level.entries()]),
    ordinal: createReadonlyMap(snapshots.map((node) => [node.id, node.ordinal]))
  })
}
