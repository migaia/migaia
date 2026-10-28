import { describe, expect, it } from 'vitest'
import { topologyNodeId } from './nonstatic-fixtures.ts'
import {
  buildCapabilityTopology,
  createTopologyIndex,
  type ICapabilityTopology,
  type ITopologyDependency,
  type ITopologyIndex
} from '../../src/graph/topology.ts'

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
      consumers.map(topologyNodeId)
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
  // Only the fixed generated corpus calls this oracle: at most 60 operations add at most 60 nodes.
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
  // The same 60-node compile-time fixture bound applies to canonical reference ordering.
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
  // Only the fixed generated corpus calls this oracle; its 60-operation bound limits nodes to 60.
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

/** Owns the deterministic generator state used by the fixed topology operation corpus. */
class TopologyRandomSequence {
  /** Current unsigned 32-bit state advances once per requested fixture decision. */
  #state: number

  /** Initializes the same seed conversion as the original closure fixture. */
  constructor(seed: number) {
    this.#state = seed >>> 0
  }

  /** Advances the existing linear-congruential sequence while retaining method extraction. */
  readonly next = (): number => {
    this.#state = (Math.imul(this.#state, 1664525) + 1013904223) >>> 0
    return this.#state
  }
}

/** Deterministic pseudo-random source used by the 200 generated operation sequences. */
function createRandom(seed: number): () => number {
  return new TopologyRandomSequence(seed).next
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

/** Measures the existing fixed 15-sample transaction fixture without nesting named functions. */
function measureTransactionBegin(size: number): number {
  const index = createTestIndex()
  for (let position = 0; position < size; position += 1)
    index.add({ id: `n-${position}`, dependencies: [] })
  const samples: number[] = []
  for (let round = 0; round < 15; round += 1) {
    const started = performance.now()
    const transaction = index.begin()
    transaction.add({ id: 'probe', dependencies: [{ provider: 'n-0', required: true }] })
    transaction.rollback()
    samples.push(performance.now() - started)
  }
  // Exactly 15 samples come from the fixed round bound above.
  return samples.sort((left, right) => left - right)[7]!
}

/**
 * Owns the isolated setup, action and assertions for: maintains dependents, missing edges, and
 * required closure.
 */
function verifyMaintainsDependentsMissingEdgesAndRequiredClosure() {
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
}

/**
 * Owns the isolated setup, action and assertions for: retains ordinal edge order and kind across
 * rewiring and transactions.
 */
function verifyRetainsOrdinalEdgeOrderAndKindAcrossRewiringAndTransactions() {
  const index = createTestIndex()
  index.add({ id: 'p', dependencies: [] })
  index.add({ id: 'older', dependencies: [{ provider: 'p', required: true }] })
  index.add({ id: 'newer', dependencies: [{ provider: 'p', required: true }] })
  index.setDependencies('older', [])
  index.setDependencies('older', [{ provider: 'p', required: true }])
  expect(index.dependents('p')).toEqual({ required: ['older', 'newer'], optional: [] })
  const transaction = index.begin()
  transaction.setDependencies('older', [{ provider: 'p', required: false }])
  expect(transaction.dependents('p')).toEqual({ required: ['newer'], optional: ['older'] })
  expect(transaction.closure(['p'])).toEqual(['p', 'newer'])
  expect(index.closure(['p'])).toEqual(['p', 'older', 'newer'])
  transaction.commit()
  expect(index.dependents('p')).toEqual({ required: ['newer'], optional: ['older'] })
  index.remove('newer')
  expect(index.dependents('p')).toEqual({ required: [], optional: ['older'] })
}

/**
 * Owns the isolated setup, action and assertions for: matches independent and static canonical
 * order across 200 operation sequences.
 */
function verifyMatchesIndependentAndStaticCanonicalOrderAcross200OperationSequences() {
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
}

/**
 * Owns the isolated setup, action and assertions for: preserves leaf mutation and closure across
 * graph sizes.
 */
function verifyPreservesLeafMutationAndClosureAcrossGraphSizes() {
  for (const size of [2, 1002, 4002, 8002]) {
    const index = createTestIndex()
    index.add({ id: 'n0', dependencies: [] })
    index.add({ id: 'n1', dependencies: [{ provider: 'n0', required: true }] })
    for (let ordinal = 2; ordinal < size; ordinal += 1)
      index.add({ id: `n${ordinal}`, dependencies: [{ provider: 'n1', required: true }] })
    index.add({ id: 'leaf', dependencies: [{ provider: `n${size - 1}`, required: true }] })
    expect(index.dependents('leaf')).toEqual({ required: [], optional: [] })
    expect(index.closure(['n0'])).toHaveLength(size + 1)
    index.remove('leaf')
    expect(index.has('leaf')).toBe(false)
    expect(index.closure(['n0'])).toHaveLength(size)
    expect(index).not.toHaveProperty('metrics')
  }
}

/**
 * Owns the isolated setup, action and assertions for: isolates, rolls back, commits, and closes
 * transactions.
 */
function verifyIsolatesRollsBackCommitsAndClosesTransactions() {
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
}

/**
 * Owns the isolated setup, action and assertions for: rejects cycle-closing add and dependency
 * replacement atomically.
 */
function verifyRejectsCycleClosingAddAndDependencyReplacementAtomically() {
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
}

/**
 * Owns the isolated setup, action and assertions for: keeps base buckets untouched while a
 * transaction rewires a shared provider.
 */
function verifyKeepsBaseBucketsUntouchedWhileATransactionRewiresASharedProvider() {
  const index = createTestIndex()
  index.add({ id: 'p', dependencies: [] })
  index.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
  const transaction = index.begin()
  transaction.add({ id: 'b', dependencies: [{ provider: 'p', required: true }] })
  transaction.remove('a')
  // The base still reads its own bucket for p while the transaction owns a copy.
  expect(index.dependents('p').required).toEqual(['a'])
  expect(transaction.dependents('p').required).toEqual(['b'])
  transaction.rollback()
  expect(index.dependents('p').required).toEqual(['a'])
  const second = index.begin()
  second.add({ id: 'b', dependencies: [{ provider: 'p', required: true }] })
  second.commit()
  expect(index.dependents('p').required).toEqual(['a', 'b'])
  expect(index.order()).toEqual(['p', 'a', 'b'])
}

/**
 * Owns the isolated setup, action and assertions for: retains base reads and commits the isolated
 * transaction.
 */
function verifyRetainsBaseReadsAndCommitsTheIsolatedTransaction() {
  const index = createTestIndex()
  index.add({ id: 'p', dependencies: [] })
  const transaction = index.begin()
  expect(index.order()).toEqual(['p'])
  transaction.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
  expect(index.order()).toEqual(['p'])
  transaction.commit()
  expect(index.order()).toEqual(['p', 'a'])
}

/**
 * Owns the isolated setup, action and assertions for: drops rolled-back writes after transaction
 * reads.
 */
function verifyDropsRolledBackWritesAfterTransactionReads() {
  const index = createTestIndex()
  index.add({ id: 'p', dependencies: [] })
  const transaction = index.begin()
  transaction.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
  expect(transaction.order()).toEqual(['p', 'a'])
  transaction.rollback()
  expect(index.has('a')).toBe(false)
  expect(index.order()).toEqual(['p'])
}

/**
 * Owns the isolated setup, action and assertions for: opens and rolls back a transaction without
 * copying the index.
 */
function verifyOpensAndRollsBackATransactionWithoutCopyingTheIndex() {
  const small = measureTransactionBegin(200)
  const large = measureTransactionBegin(50_000)
  // Copying the stores would make the large case roughly 250 times slower; an overlay keeps it
  // flat. The generous bound absorbs timer noise without admitting an O(nodes) copy.
  expect(large).toBeLessThan(Math.max(small, 0.05) * 25)
}

/** Verifies mixed consumer reconnect order and isolated publication with four fixed consumers. */
function verifyMixedConsumerReconnectOrderAcrossTransactionSettlement(): void {
  /** Four consumers precede their provider so admission also exercises existing dangling buckets. */
  const index = createTestIndex()
  index.add({ id: 'older-required', dependencies: [{ provider: 'p', required: true }] })
  index.add({ id: 'older-optional', dependencies: [{ provider: 'p', required: false }] })
  index.add({ id: 'newer-required', dependencies: [{ provider: 'p', required: true }] })
  index.add({ id: 'newer-optional', dependencies: [{ provider: 'p', required: false }] })
  index.add({ id: 'p', dependencies: [] })
  /** Expected registration order is independent of physical bucket insertion and returned arrays. */
  const before = {
    required: ['older-required', 'newer-required'],
    optional: ['older-optional', 'newer-optional']
  }
  expect(index.dependents('p')).toEqual(before)
  index.setDependencies('older-optional', [])
  index.setDependencies('older-optional', [{ provider: 'p', required: false }])
  expect(index.dependents('p')).toEqual(before)
  /** Switching old edge kinds must still place both old consumers before newer registrations. */
  const rewired = {
    required: ['older-optional', 'newer-required'],
    optional: ['older-required', 'newer-optional']
  }
  /** Two literal modes give O(1) fixture work; each rewires the same four fixed consumers. */
  for (const settlement of ['rollback', 'commit'] as const) {
    /** Working buckets must own their edits until this transaction explicitly settles. */
    const transaction = index.begin()
    transaction.setDependencies('older-required', [])
    transaction.setDependencies('older-optional', [])
    transaction.setDependencies('older-required', [{ provider: 'p', required: false }])
    transaction.setDependencies('older-optional', [{ provider: 'p', required: true }])
    expect(transaction.dependents('p')).toEqual(rewired)
    expect(index.dependents('p')).toEqual(before)
    transaction[settlement]()
    expect(index.dependents('p')).toEqual(settlement === 'rollback' ? before : rewired)
  }
}

describe('incremental topology index', () => {
  it(
    'maintains dependents, missing edges, and required closure',
    verifyMaintainsDependentsMissingEdgesAndRequiredClosure
  )

  it(
    'retains ordinal edge order and kind across rewiring and transactions',
    verifyRetainsOrdinalEdgeOrderAndKindAcrossRewiringAndTransactions
  )

  it(
    'retains both consumer partitions through reconnect, rollback, and commit',
    verifyMixedConsumerReconnectOrderAcrossTransactionSettlement
  )

  it(
    'matches independent and static canonical order across 200 operation sequences',
    verifyMatchesIndependentAndStaticCanonicalOrderAcross200OperationSequences
  )

  it(
    'preserves leaf mutation and closure across graph sizes',
    verifyPreservesLeafMutationAndClosureAcrossGraphSizes
  )

  it(
    'isolates, rolls back, commits, and closes transactions',
    verifyIsolatesRollsBackCommitsAndClosesTransactions
  )

  it(
    'rejects cycle-closing add and dependency replacement atomically',
    verifyRejectsCycleClosingAddAndDependencyReplacementAtomically
  )

  it(
    'keeps base buckets untouched while a transaction rewires a shared provider',
    verifyKeepsBaseBucketsUntouchedWhileATransactionRewiresASharedProvider
  )

  it(
    'retains base reads and commits the isolated transaction',
    verifyRetainsBaseReadsAndCommitsTheIsolatedTransaction
  )

  it(
    'drops rolled-back writes after transaction reads',
    verifyDropsRolledBackWritesAfterTransactionReads
  )

  it(
    'opens and rolls back a transaction without copying the index',
    verifyOpensAndRollsBackATransactionWithoutCopyingTheIndex
  )
})
