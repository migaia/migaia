import { describe, expect, it } from 'vitest'
import {
  buildCapabilityTopology,
  createTopologyIndex,
  type ICapabilityTopology,
  type ITopologyDependency,
  type ITopologyIndex
} from '../../src/graph/topology.js'

type IReferenceNode = Readonly<{
  readonly id: string
  readonly ordinal: number
  readonly dependencies: readonly ITopologyDependency[]
}>

type IProjectedTopology = Readonly<{
  readonly ordered: readonly string[]
  readonly providers: readonly (readonly [string, readonly string[]])[]
  readonly consumers: readonly (readonly [string, readonly ITopologyDependency[]])[]
  readonly indegree: readonly (readonly [string, number])[]
  readonly level: readonly (readonly [string, number])[]
  readonly ordinal: readonly (readonly [string, number])[]
}>

/** Converts read-only map facades into ordinary data for deep equality assertions. */
function projectTopology(topology: ICapabilityTopology): IProjectedTopology {
  return {
    ordered: topology.ordered.map((node) => node.id),
    providers: [...topology.providers].map(([provider, consumers]) => [
      provider,
      consumers.map((consumer) => consumer.id)
    ]),
    consumers: [...topology.consumers],
    indegree: [...topology.indegree],
    level: [...topology.level],
    ordinal: [...topology.ordinal]
  }
}

/** Creates an index whose adapter exposes structural failures as inspectable test errors. */
function createTestIndex(): ITopologyIndex {
  return createTopologyIndex({
    onCycle: (path) => {
      throw Object.assign(new Error('cycle'), { path })
    },
    onInvalid: (reason, nodeId) => {
      throw Object.assign(new Error('invalid topology operation'), { reason, nodeId })
    }
  })
}

/** Adds the common five-node transaction fixture to one index. */
function seedTransactionIndex(index: ITopologyIndex): void {
  index.add({ id: 'x', dependencies: [] })
  index.add({ id: 'y', dependencies: [{ provider: 'x', required: true }] })
  index.add({ id: 'z', dependencies: [{ provider: 'y', required: true }] })
  index.add({ id: 'q', dependencies: [] })
  index.add({ id: 'r', dependencies: [{ provider: 'q', required: false }] })
}

/** Returns the independent canonical order for the current acyclic reference state. */
function referenceOrder(nodes: ReadonlyMap<string, IReferenceNode>): readonly string[] {
  /** Nodes in registration order make every generated provider precede its consumer. */
  const orderedByOrdinal = [...nodes.values()].sort((left, right) => left.ordinal - right.ordinal)
  /** Canonical level derived without using the production index implementation. */
  const levels = new Map<string, number>()
  for (const node of orderedByOrdinal) {
    let level = 0
    for (const dependency of node.dependencies) {
      if (!nodes.has(dependency.provider)) continue
      level = Math.max(level, (levels.get(dependency.provider) ?? 0) + 1)
    }
    levels.set(node.id, level)
  }
  return orderedByOrdinal
    .sort(
      (left, right) =>
        (levels.get(left.id) ?? 0) - (levels.get(right.id) ?? 0) || left.ordinal - right.ordinal
    )
    .map((node) => node.id)
}

/** Projects the same reference state through the pre-existing static topology oracle. */
function staticOrder(nodes: ReadonlyMap<string, IReferenceNode>): readonly string[] {
  /** Dense ordinal projection required by the static topology input contract. */
  const staticNodes = [...nodes.values()]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((node, ordinal) => ({ ...node, ordinal }))
  /** Static topology result used as a second implementation-independent oracle. */
  const topology = buildCapabilityTopology(
    staticNodes,
    () => undefined as never,
    (path) => {
      throw new Error(`unexpected cycle ${path.join(' -> ')}`)
    },
    (reason, nodeId) => {
      throw new Error(`unexpected ${reason}${nodeId ? ` for ${nodeId}` : ''}`)
    }
  )
  return topology.ordered.map((node) => node.id)
}

/** Deterministic pseudo-random source used by the 200 generated operation sequences. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
}

/** Builds up to two acyclic edges, including a stable dangling optional edge. */
function randomDependencies(
  random: () => number,
  nodes: ReadonlyMap<string, IReferenceNode>,
  consumerOrdinal: number
): readonly ITopologyDependency[] {
  /** Only earlier providers are eligible, preserving acyclicity independently of production code. */
  const providers = [...nodes.values()].filter((node) => node.ordinal < consumerOrdinal)
  /** Provider IDs already emitted for this consumer. */
  const used = new Set<string>()
  /** Generated edge list for the next mutation. */
  const dependencies: ITopologyDependency[] = []
  const count = Math.min(random() % 3, providers.length + 1)
  for (let index = 0; index < count; index += 1) {
    const useMissing = random() % 5 === 0
    const provider = useMissing
      ? `missing-${random() % 4}`
      : providers[random() % providers.length]?.id
    if (!provider || used.has(provider)) continue
    used.add(provider)
    dependencies.push({ provider, required: !useMissing && random() % 2 === 0 })
  }
  return dependencies
}

/** Reads a metrics delta without changing index counters. */
function metricDelta(
  before: Readonly<{ visitedNodes: number; visitedEdges: number }>,
  after: Readonly<{ visitedNodes: number; visitedEdges: number }>
): Readonly<{ visitedNodes: number; visitedEdges: number }> {
  return {
    visitedNodes: after.visitedNodes - before.visitedNodes,
    visitedEdges: after.visitedEdges - before.visitedEdges
  }
}

describe('incremental topology index', () => {
  it('A1 maintains dependents, missing edges, and required closure', () => {
    const index = createTestIndex()
    index.add({ id: 'p', dependencies: [] })
    index.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 'b', dependencies: [{ provider: 'a', required: true }] })
    index.add({ id: 'c', dependencies: [{ provider: 'p', required: false }] })
    index.add({ id: 'd', dependencies: [{ provider: 'q', required: false }] })

    expect(index.dependents('p')).toEqual({ required: ['a'], optional: ['c'] })
    expect(index.missing('d')).toEqual([{ provider: 'q', required: false }])
    expect(index.closure(['p'])).toEqual(['p', 'a', 'b'])

    index.remove('p')
    expect(index.missing('a')).toEqual([{ provider: 'p', required: true }])
    expect(index.dependents('a')).toEqual({ required: ['b'], optional: [] })
    index.add({ id: 'p', dependencies: [] })
    expect(index.missing('a')).toEqual([])
    expect(index.dependents('p')).toEqual({ required: ['a'], optional: ['c'] })
    expect(() => index.add({ id: 'a', dependencies: [] })).toThrow(
      expect.objectContaining({ reason: 'duplicate-node', nodeId: 'a' })
    )
    expect(() => index.dependencies('unknown')).toThrow(
      expect.objectContaining({ reason: 'unknown-node', nodeId: 'unknown' })
    )
  })

  it('A2 matches independent and static canonical order across 200 operation sequences', () => {
    for (let sequence = 0; sequence < 200; sequence += 1) {
      const random = createRandom(0x9e3779b9 ^ sequence)
      const index = createTestIndex()
      const nodes = new Map<string, IReferenceNode>()
      let nextOrdinal = 0
      const operationCount = 2 + (random() % 59)

      for (let operation = 0; operation < operationCount; operation += 1) {
        const present = [...nodes.values()]
        const choice = present.length === 0 ? 0 : random() % 3
        if (choice === 0) {
          const id = `s${sequence}-n${nextOrdinal}`
          const dependencies = randomDependencies(random, nodes, nextOrdinal)
          index.add({ id, dependencies })
          nodes.set(id, { id, ordinal: nextOrdinal, dependencies })
          nextOrdinal += 1
        } else if (choice === 1 && present.length > 1) {
          const node = present[random() % present.length]!
          index.remove(node.id)
          nodes.delete(node.id)
        } else {
          const node = present[random() % present.length]!
          const dependencies = randomDependencies(random, nodes, node.ordinal)
          index.setDependencies(node.id, dependencies)
          nodes.set(node.id, { ...node, dependencies })
        }

        expect(index.order()).toEqual(referenceOrder(nodes))
        expect(index.order()).toEqual(staticOrder(nodes))
      }
    }
  })

  it('A3 keeps leaf mutation costs independent of total graph size', () => {
    const deltas: Array<
      Readonly<{
        add: Readonly<{ visitedNodes: number; visitedEdges: number }>
        dependents: Readonly<{ visitedNodes: number; visitedEdges: number }>
        remove: Readonly<{ visitedNodes: number; visitedEdges: number }>
      }>
    > = []

    for (const size of [2, 1002, 4002, 8002]) {
      const index = createTestIndex()
      index.add({ id: 'n0', dependencies: [] })
      index.add({ id: 'n1', dependencies: [{ provider: 'n0', required: true }] })
      for (let ordinal = 2; ordinal < size; ordinal += 1)
        index.add({
          id: `n${ordinal}`,
          dependencies: [{ provider: 'n1', required: true }]
        })

      const beforeAdd = index.metrics()
      index.add({ id: 'leaf', dependencies: [{ provider: `n${size - 1}`, required: true }] })
      const afterAdd = index.metrics()
      index.dependents('leaf')
      const afterDependents = index.metrics()
      index.remove('leaf')
      const afterRemove = index.metrics()
      deltas.push({
        add: metricDelta(beforeAdd, afterAdd),
        dependents: metricDelta(afterAdd, afterDependents),
        remove: metricDelta(afterDependents, afterRemove)
      })

      const beforeClosure = index.metrics()
      expect(index.closure(['n0'])).toHaveLength(size)
      const closureDelta = metricDelta(beforeClosure, index.metrics())
      expect(closureDelta).toEqual({ visitedNodes: size, visitedEdges: size - 1 })
    }

    expect(deltas.every((delta) => delta.add.visitedNodes <= 3)).toBe(true)
    expect(deltas).toEqual([deltas[0], deltas[0], deltas[0], deltas[0]])
  })

  it('A4 isolates, rolls back, commits, and closes transactions', () => {
    const index = createTestIndex()
    const control = createTestIndex()
    seedTransactionIndex(index)
    seedTransactionIndex(control)
    const before = projectTopology(index.snapshot())
    const beforeOrder = index.order()

    const transaction = index.begin()
    transaction.add({ id: 't', dependencies: [{ provider: 'z', required: true }] })
    transaction.add({ id: 'u', dependencies: [] })
    transaction.setDependencies('q', [{ provider: 'x', required: true }])
    transaction.remove('y')
    expect(index.order()).toEqual(beforeOrder)
    expect(() => index.begin()).toThrow(expect.objectContaining({ reason: 'transaction-open' }))
    expect(() => index.add({ id: 'blocked', dependencies: [] })).toThrow(
      expect.objectContaining({ reason: 'transaction-open' })
    )
    transaction.rollback()
    expect(projectTopology(index.snapshot())).toEqual(before)
    expect(() => transaction.order()).toThrow(
      expect.objectContaining({ reason: 'transaction-closed' })
    )

    for (const candidate of [index, control]) {
      candidate.add({ id: 'w', dependencies: [{ provider: 'x', required: true }] })
      candidate.add({ id: 'v', dependencies: [] })
    }
    expect(projectTopology(index.snapshot())).toEqual(projectTopology(control.snapshot()))
    expect(index.order()).toEqual(control.order())

    const committed = createTestIndex()
    seedTransactionIndex(committed)
    const commit = committed.begin()
    commit.add({ id: 't', dependencies: [{ provider: 'z', required: true }] })
    commit.add({ id: 'u', dependencies: [] })
    commit.setDependencies('q', [{ provider: 'x', required: true }])
    commit.remove('y')
    commit.commit()
    expect(committed.has('t')).toBe(true)
    expect(committed.has('u')).toBe(true)
    expect(committed.has('y')).toBe(false)
    expect(committed.dependencies('q')).toEqual([{ provider: 'x', required: true }])
  })

  it('A5 rejects cycle-closing add and dependency replacement atomically', () => {
    const dangling = createTestIndex()
    dangling.add({ id: 'b', dependencies: [{ provider: 'a', required: false }] })
    const beforeAdd = projectTopology(dangling.snapshot())
    expect(() =>
      dangling.add({ id: 'a', dependencies: [{ provider: 'b', required: true }] })
    ).toThrow(expect.objectContaining({ path: ['a', 'b', 'a'] }))
    expect(dangling.has('a')).toBe(false)
    expect(projectTopology(dangling.snapshot())).toEqual(beforeAdd)

    const existing = createTestIndex()
    existing.add({ id: 'p', dependencies: [] })
    existing.add({ id: 'q', dependencies: [{ provider: 'p', required: true }] })
    expect(() => existing.setDependencies('p', [{ provider: 'q', required: true }])).toThrow(
      expect.objectContaining({ path: ['p', 'q', 'p'] })
    )
    expect(existing.dependencies('p')).toEqual([])
  })
})
