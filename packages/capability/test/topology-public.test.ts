import {
  throwUnknownTopologyProvider,
  throwUnknownTopologyProvider as unknown,
  throwTopologyPath as cycle,
  throwTopologyReason as invalid,
  throwTopologyCycle,
  throwInvalidTopology,
  throwTopologyPath,
  expectInvalidTopology,
  CountedTopologyNode,
  TopologyCycleFailure
} from './fixtures/topology-public.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { buildCapabilityTopology as graphBuildCapabilityTopology } from '../src/graph/index.ts'
import {
  buildCapabilityTopology,
  TopologyInvalidReason,
  type ITopologyNode
} from '../src/graph/topology.ts'

const id = (value: string): string => value

describe('public capability topology primitive', () => {
  it(
    'exposes the same pure builder used by CapabilityGraph',
    verifyExposesTheSamePureBuilderUsedByCapabilityGraph
  )

  it(
    'rejects missing providers and cycles without lifecycle side effects',
    verifyRejectsMissingProvidersAndCyclesWithoutLifecycleSideEffects
  )

  it(
    'snapshots inputs, uses ordinal order, and rejects duplicate facts',
    verifySnapshotsInputsUsesOrdinalOrderAndRejectsDuplicateFacts
  )

  it(
    'routes hostile runtime facts through one invalid adapter read',
    verifyRoutesHostileRuntimeFactsThroughOneInvalidAdapterRead
  )

  it(
    'uses linear ordinal placement with one read per node and edge',
    verifyUsesLinearOrdinalPlacementWithOneReadPerNodeAndEdge
  )

  it(
    'builds a static graph without comparison sorting',
    verifyBuildsAStaticGraphWithoutComparisonSorting
  )

  it.each([false, true])(
    'handles long chains in either registration direction (%s)',
    verifyHandlesLongChainsInEitherRegistrationDirectionS
  )

  it(
    'keeps shared providers, diamonds and wide levels in ordinal order',
    verifyKeepsSharedProvidersDiamondsAndWideLevelsInOrdinalOrder
  )

  it(
    'reports the first DFS cycle by root ordinal and declared edge order',
    verifyReportsTheFirstDFSCycleByRootOrdinalAndDeclaredEdgeOrder
  )

  it('declares the exact public topology export', verifyDeclaresTheExactPublicTopologyExport)
})

/** Executes the existing case: exposes the same pure builder used by CapabilityGraph. */
function verifyExposesTheSamePureBuilderUsedByCapabilityGraph(): void {
  const nodes: ITopologyNode[] = [
    {
      id: id('consumer'),
      dependencies: [{ provider: id('provider'), required: true }],
      ordinal: 0
    },
    { id: id('provider'), dependencies: [], ordinal: 1 }
  ]

  expect(graphBuildCapabilityTopology).toBe(buildCapabilityTopology)
  const topology = buildCapabilityTopology(nodes, unknown, cycle, throwInvalidTopology)
  expect(topology.ordered.map((node) => node.id)).toEqual(['provider', 'consumer'])
  expect(topology.providers.get('provider')?.map((node) => node.id)).toEqual(['consumer'])
  expect(topology.consumers.get('consumer')).toEqual(nodes[0]?.dependencies)
  expect(topology.level.get('consumer')).toBe(1)
  expect(topology.ordinal.get('consumer')).toBe(0)
}

/** Executes the existing case: rejects missing providers and cycles without lifecycle side effects. */
function verifyRejectsMissingProvidersAndCyclesWithoutLifecycleSideEffects(): void {
  let started = 0
  const nodes: ITopologyNode[] = [
    { id: id('a'), dependencies: [{ provider: id('b'), required: true }], ordinal: 0 },
    { id: id('b'), dependencies: [{ provider: id('a'), required: true }], ordinal: 1 }
  ]
  expect(() =>
    buildCapabilityTopology(
      [
        {
          id: id('missing'),
          dependencies: [{ provider: id('absent'), required: true }],
          ordinal: 0
        }
      ],
      throwUnknownTopologyProvider,
      throwTopologyCycle,
      throwInvalidTopology
    )
  ).toThrow('unknown provider')
  expect(() =>
    buildCapabilityTopology(
      nodes,
      throwUnknownTopologyProvider,
      throwTopologyPath,
      throwInvalidTopology
    )
  ).toThrow('a>b>a')
  expect(started).toBe(0)
}

/** Executes the existing case: snapshots inputs, uses ordinal order, and rejects duplicate facts. */
function verifySnapshotsInputsUsesOrdinalOrderAndRejectsDuplicateFacts(): void {
  const dependencies: ITopologyNode['dependencies'] = [{ provider: 'provider', required: true }]
  const consumer: ITopologyNode = { id: 'consumer', dependencies, ordinal: 3 }
  const provider: ITopologyNode = { id: 'provider', dependencies: [], ordinal: 2 }
  const late: ITopologyNode = { id: 'late', dependencies: [], ordinal: 1 }
  const early: ITopologyNode = { id: 'early', dependencies: [], ordinal: 0 }
  const topology = buildCapabilityTopology(
    [consumer, early, provider, late],
    throwUnknownTopologyProvider,
    throwTopologyCycle,
    invalid
  )

  expect(topology.ordered.map((node) => node.id)).toEqual(['early', 'late', 'provider', 'consumer'])
  expect(Object.isFrozen(topology.ordered)).toBe(true)
  expect(Object.isFrozen(topology.ordered[0])).toBe(true)
  expect(Object.isFrozen(topology.ordered[1]?.dependencies)).toBe(true)
  expect(Object.isFrozen(topology.providers)).toBe(true)
  expect(Object.isFrozen(topology.consumers)).toBe(true)
  expect(() =>
    (topology.providers as Map<string, readonly ITopologyNode[]>).set('forged', [])
  ).toThrow()

  ;(dependencies as Array<{ provider: string; required: true }>)[0]!.provider = 'forged'
  expect(topology.consumers.get('consumer')).toEqual([{ provider: 'provider', required: true }])

  expect(() =>
    buildCapabilityTopology(
      [
        { id: 'duplicate', dependencies: [], ordinal: 0 },
        { id: 'duplicate', dependencies: [], ordinal: 1 }
      ],
      throwUnknownTopologyProvider,
      throwTopologyCycle,
      invalid
    )
  ).toThrow(TopologyInvalidReason.duplicateNode)
  expect(() =>
    buildCapabilityTopology(
      [
        { id: 'first', dependencies: [], ordinal: 0 },
        { id: 'second', dependencies: [], ordinal: 0 }
      ],
      throwUnknownTopologyProvider,
      throwTopologyCycle,
      invalid
    )
  ).toThrow(TopologyInvalidReason.duplicateOrdinal)
}

/** Executes the existing case: routes hostile runtime facts through one invalid adapter read. */
function verifyRoutesHostileRuntimeFactsThroughOneInvalidAdapterRead(): void {
  expectInvalidTopology([null])
  expectInvalidTopology([42])
  expectInvalidTopology([{ id: 'edge', ordinal: 0, dependencies: [null] }])
  const sparse: unknown[] = []
  sparse.length = 1
  expectInvalidTopology(sparse)

  let getterReads = 0
  const getterNode = {
    get id(): string {
      getterReads += 1
      return 'getter'
    },
    get ordinal(): number {
      getterReads += 1
      return 0
    },
    get dependencies(): readonly ITopologyNode['dependencies'][number][] {
      getterReads += 1
      return []
    }
  }
  buildCapabilityTopology([getterNode], unknown, cycle, invalid)
  expect(getterReads).toBe(3)

  const throwingIterable = {
    [Symbol.iterator](): Iterator<unknown> {
      throw new Error('iterator failure')
    }
  }
  expectInvalidTopology([{ id: 'iterator', ordinal: 0, dependencies: throwingIterable }])

  let proxyReads = 0
  const proxiedNode = new Proxy(
    { id: 'proxy', ordinal: 0, dependencies: [] },
    {
      get(target, property, receiver) {
        proxyReads += 1
        return Reflect.get(target, property, receiver)
      }
    }
  )
  buildCapabilityTopology([proxiedNode], unknown, cycle, invalid)
  expect(proxyReads).toBe(3)
}

/** Executes the existing case: uses linear ordinal placement with one read per node and edge. */
function verifyUsesLinearOrdinalPlacementWithOneReadPerNodeAndEdge(): void {
  const counts = { id: 0, ordinal: 0, dependencies: 0, provider: 0, required: 0 }
  const nodeCount = 64
  const nodes = Array.from(
    { length: nodeCount },
    (_, index) => new CountedTopologyNode(counts, index)
  )
  const topology = buildCapabilityTopology(
    nodes,
    throwUnknownTopologyProvider,
    throwTopologyCycle,
    throwInvalidTopology
  )
  expect(topology.ordered).toHaveLength(nodeCount)
  expect(counts).toEqual({
    id: nodeCount,
    ordinal: nodeCount,
    dependencies: nodeCount,
    provider: nodeCount - 1,
    required: nodeCount - 1
  })
}

/** Executes the existing case: builds a static graph without comparison sorting. */
function verifyBuildsAStaticGraphWithoutComparisonSorting(): void {
  /** Sorting would hide a superlinear static projection even when getter reads stay linear. */
  const sorting = vi.spyOn(Array.prototype, 'sort')
  try {
    buildCapabilityTopology(
      [
        { id: 'consumer', ordinal: 0, dependencies: [{ provider: 'provider', required: true }] },
        { id: 'provider', ordinal: 1, dependencies: [] }
      ],
      throwUnknownTopologyProvider,
      throwTopologyCycle,
      throwInvalidTopology
    )
    expect(sorting).not.toHaveBeenCalled()
  } finally {
    sorting.mockRestore()
  }
}

/** Executes the existing case: handles long chains in either registration direction (%s). */
function verifyHandlesLongChainsInEitherRegistrationDirectionS(reverse: boolean): void {
  /** Larger than ordinary host recursion limits; no timing threshold is needed. */
  const size = 20000
  /** Dense ordinals may follow providers or consumers. */
  const nodes: ITopologyNode[] = Array.from({ length: size }, (_, index) => ({
    id: `node-${index}`,
    ordinal: reverse ? size - index - 1 : index,
    dependencies: index === 0 ? [] : [{ provider: `node-${index - 1}`, required: true }]
  }))
  const topology = buildCapabilityTopology(
    nodes,
    throwUnknownTopologyProvider,
    throwTopologyCycle,
    throwInvalidTopology
  )
  expect(topology.ordered.map((node) => node.id)).toEqual(nodes.map((node) => node.id))
  expect(topology.level.get(`node-${size - 1}`)).toBe(size - 1)
}

/** Executes the existing case: keeps shared providers, diamonds and wide levels in ordinal order. */
function verifyKeepsSharedProvidersDiamondsAndWideLevelsInOrdinalOrder(): void {
  /** Two same-level consumers share one root, and the final consumer joins their paths. */
  const nodes: ITopologyNode[] = [
    {
      id: 'join',
      ordinal: 0,
      dependencies: [
        { provider: 'left', required: true },
        { provider: 'right', required: true }
      ]
    },
    { id: 'right', ordinal: 1, dependencies: [{ provider: 'root', required: true }] },
    { id: 'left', ordinal: 2, dependencies: [{ provider: 'root', required: true }] },
    { id: 'root', ordinal: 3, dependencies: [] },
    ...Array.from({ length: 64 }, (_, index) => ({
      id: `wide-${index}`,
      ordinal: index + 4,
      dependencies: []
    }))
  ]
  const topology = buildCapabilityTopology(
    nodes,
    throwUnknownTopologyProvider,
    throwTopologyCycle,
    throwInvalidTopology
  )
  expect(topology.ordered.slice(0, 65).map((node) => node.id)).toEqual([
    'root',
    ...nodes.slice(4).map((node) => node.id)
  ])
  expect(topology.ordered.slice(-3).map((node) => node.id)).toEqual(['right', 'left', 'join'])
  expect(topology.providers.get('root')?.map((node) => node.id)).toEqual(['right', 'left'])
  expect(topology.level.get('join')).toBe(2)
}

/** Executes the existing case: reports the first DFS cycle by root ordinal and declared edge order. */
function verifyReportsTheFirstDFSCycleByRootOrdinalAndDeclaredEdgeOrder(): void {
  /** The first root reaches the later cycle first; insertion order must not choose another. */
  const nodes: ITopologyNode[] = [
    { id: 'other', ordinal: 4, dependencies: [{ provider: 'other', required: true }] },
    {
      id: 'root',
      ordinal: 0,
      dependencies: [
        { provider: 'right', required: true },
        { provider: 'left', required: true }
      ]
    },
    { id: 'left', ordinal: 1, dependencies: [{ provider: 'left', required: true }] },
    { id: 'right', ordinal: 2, dependencies: [{ provider: 'tail', required: true }] },
    { id: 'tail', ordinal: 3, dependencies: [{ provider: 'right', required: true }] }
  ]
  /** Caller-owned shell retains its native type and public code. */
  const failure = Object.assign(new TypeError('cycle'), {
    code: 'CUSTOM_CYCLE',
    path: [] as readonly string[]
  })
  /** Cycle publication and failure remain inside the original expect-triggered build call. */
  const cycleFailure = new TopologyCycleFailure(failure)
  expect(() =>
    buildCapabilityTopology(
      nodes,
      throwUnknownTopologyProvider,
      cycleFailure.onCycle,
      throwInvalidTopology
    )
  ).toThrow(failure)
  expect(failure.path).toEqual(['right', 'tail', 'right'])
  expect(Object.isFrozen(failure.path)).toBe(true)
  expect(failure.code).toBe('CUSTOM_CYCLE')
}

/** Executes the existing case: declares the exact public topology export. */
function verifyDeclaresTheExactPublicTopologyExport(): void {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
  ) as { exports?: Record<string, unknown> }
  expect(manifest.exports?.['./graph/topology']).toEqual({
    types: './dist/graph/topology.d.ts',
    default: './dist/graph/topology.js'
  })
}
