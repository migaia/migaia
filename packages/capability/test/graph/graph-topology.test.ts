import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { walkErrorCauses } from '@migaia/utils/error'
import {
  CapabilityGraphErrorCode,
  CapabilityGraphNodeState,
  CapabilityGraphState,
  createCapabilityGraph
} from '../../src/graph/index.ts'
import { CapabilityGraphErrorText } from '../../src/graph/error-text.ts'
import { CAPABILITY_GRAPH_SOURCE } from '../../src/graph/errors.ts'
import { buildCapabilityTopology, type ITopologyNode } from '../../src/graph/topology.ts'

import {
  id,
  instance,
  readyInstance,
  registerTracedStaticNode,
  failingStaticInstance,
  tracedAuxiliaryDescriptor,
  tracedStaticInstance,
  measureStaticStartup,
  deferred,
  readStaticGraphSource
} from './static-fixtures.ts'

/**
 * Covers the contract: settles a failed level and preserves ordinal primary plus secondary
 * failures.
 */
async function settlesAFailedLevelAndPreservesOrdinalPrimaryPlusSecondaryFailures(): Promise<void> {
  /** Two independently failing starts deliberately reject in reverse registration order. */
  const first = deferred<ReturnType<typeof instance<number>>>()
  /** A separate rejection lets the later node fail before the canonical primary. */
  const second = deferred<ReturnType<typeof instance<number>>>()
  /** Canonical primary identity must survive attachment of its sibling failure. */
  const firstFailure = new Error('first start')
  /** This failure must remain reachable even though it occurs before the primary. */
  const secondFailure = new Error('second start')
  /** The successful sibling must be rolled back despite settling before either failure. */
  const release = vi.fn()
  /** No later-level start may run after any member of this level fails. */
  const consumer = vi.fn(() => instance(4))
  /** Invocation evidence ensures both deferred starts are actually in flight. */
  const started: string[] = []
  /** The same public lifecycle owns successful peers and startup rollback. */
  const graph = createCapabilityGraph()
  for (const [name, gate] of [
    ['first', first],
    ['second', second]
  ] as const)
    graph.register({
      id: id(name),
      kind: 'test',
      dependencies: [],
      start: () => {
        started.push(name)
        return gate.promise
      }
    })
  graph.register({
    id: id('success'),
    kind: 'test',
    dependencies: [],
    start: () => instance(3, release)
  })
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('success'), required: true }],
    start: consumer
  })
  /** Observe the ready rejection immediately so the fixture introduces no unhandled rejection. */
  let settled = false
  /** Observe the final primary without creating an unhandled readiness rejection. */
  const ready = graph.ready().then(
    () => {
      settled = true
      return undefined
    },
    (error: unknown) => {
      settled = true
      return error
    }
  )
  try {
    expect([...started]).toEqual(['first', 'second'])
    second.reject(secondFailure)
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(release).not.toHaveBeenCalled()
    first.reject(firstFailure)
    const failure = await ready
    expect(failure).toBe(firstFailure)
    expect(failure).toMatchObject({
      code: CapabilityGraphErrorCode.startFailed,
      errors: [secondFailure]
    })
    expect(graph.error).toBe(failure)
    expect(graph.nodeState(id('first')).error).toBe(firstFailure)
    expect(graph.nodeState(id('second')).error).toBe(secondFailure)
    expect(release).toHaveBeenCalledTimes(1)
    expect(consumer).not.toHaveBeenCalled()
    expect(graph.nodeState(id('consumer')).state).toBe(CapabilityGraphNodeState.blocked)
  } finally {
    first.resolve(instance(1))
    second.resolve(instance(2))
    await ready
    await graph.dispose()
  }
}

/** Covers the contract: uses dependency topology before registration ordinal. */
async function usesDependencyTopologyBeforeRegistrationOrdinal(): Promise<void> {
  const order: string[] = []
  const graph = createCapabilityGraph()
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('provider'), required: true }],
    start: () => {
      order.push('consumer')
      return instance(1)
    }
  })
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: () => {
      order.push('provider')
      return instance(1)
    }
  })
  await graph.ready()
  expect(order).toEqual(['provider', 'consumer'])
}

/** Covers the contract: snapshots onError once before lifecycle construction. */
function snapshotsOnErrorOnceBeforeLifecycleConstruction(): void {
  let reads = 0
  const optionError = new Error('option getter failed')
  const options = {
    get onError() {
      reads += 1
      throw optionError
    }
  }
  expect(() => createCapabilityGraph(options as never)).toThrow(
    expect.objectContaining({
      code: CapabilityGraphErrorCode.invalidOption,
      cause: optionError
    })
  )
  expect(reads).toBe(1)
}

/** Covers the contract: starts disconnected nodes by stable registration ordinal. */
async function startsDisconnectedNodesByStableRegistrationOrdinal(): Promise<void> {
  const order: string[] = []
  const graph = createCapabilityGraph()
  graph.register({
    id: id('a'),
    kind: 'test',
    dependencies: [],
    start: () => {
      order.push('a')
      return instance(1)
    }
  })
  graph.register({
    id: id('b'),
    kind: 'test',
    dependencies: [],
    start: () => {
      order.push('b')
      return instance(2)
    }
  })
  await graph.ready()
  expect(order).toEqual(['a', 'b'])
}

/** Covers the contract: rejects cycles before user code and reports a stable path. */
async function rejectsCyclesBeforeUserCodeAndReportsAStablePath(): Promise<void> {
  const order: string[] = []
  const graph = createCapabilityGraph()
  graph.register({
    id: id('c'),
    kind: 'test',
    dependencies: [{ provider: id('a'), required: true }],
    start: ({ get }) => {
      order.push(`c:${get(id('a'))}`)
      return instance('C')
    }
  })
  graph.register({
    id: id('a'),
    kind: 'test',
    dependencies: [],
    start: () => {
      order.push('a')
      return instance('A')
    }
  })
  graph.register({
    id: id('b'),
    kind: 'test',
    dependencies: [],
    start: () => {
      order.push('b')
      return instance('B')
    }
  })
  await graph.ready()
  expect(order).toEqual(['a', 'b', 'c:A'])
  expect(graph.get(id('c'), id('a'))).toBe('A')

  const cycle = createCapabilityGraph()
  cycle.register({
    id: id('x'),
    kind: 'test',
    dependencies: [{ provider: id('y'), required: true }],
    start: readyInstance
  })
  cycle.register({
    id: id('y'),
    kind: 'test',
    dependencies: [{ provider: id('x'), required: true }],
    start: () => instance(2)
  })
  await expect(cycle.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.dependencyCycle
  })
}

/** Covers the contract: releases primary before auxiliary and in inverse topology. */
async function releasesPrimaryBeforeAuxiliaryAndInInverseTopology(): Promise<void> {
  const events: string[] = []
  const graph = createCapabilityGraph()
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: ({ own }) => {
      own({}, tracedAuxiliaryDescriptor(events, 'provider-aux'))
      return tracedStaticInstance('provider', events, 'provider-primary')
    }
  })
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('provider'), required: true }],
    start: ({ own }) => {
      own({}, tracedAuxiliaryDescriptor(events, 'consumer-aux'))
      return tracedStaticInstance('consumer', events, 'consumer-primary')
    }
  })
  await graph.ready()
  await graph.dispose()
  expect(events).toEqual(['consumer-primary', 'consumer-aux', 'provider-primary', 'provider-aux'])
}

/**
 * Covers the contract: builds sparse topology through reverse adjacency without a full consumer
 * scan.
 */
async function buildsSparseTopologyThroughReverseAdjacencyWithoutAFullConsumerScan(): Promise<void> {
  const source = readStaticGraphSource()
  expect(source).toContain('buildCapabilityTopology')
  expect(source).not.toMatch(/for \(const consumer of nodeOrder\)/)

  const graph = createCapabilityGraph()
  const count = 1024
  for (let index = 0; index < count; index += 1) {
    graph.register({
      id: id(`node-${index}`),
      kind: 'benchmark',
      dependencies: index === 0 ? [] : [{ provider: id(`node-${index - 1}`), required: true }],
      start: () => instance(index)
    })
  }
  await graph.ready()
  expect(graph.state).toBe('ready')
  await graph.dispose()

  await measureStaticStartup(128)
  const medium = await measureStaticStartup(512)
  const large = await measureStaticStartup(2048)
  expect(large).toBeLessThan(medium * 12 + 25)
}

/** Covers the contract: uses level then ordinal startup and strict reverse release. */
async function usesLevelThenOrdinalStartupAndStrictReverseRelease(): Promise<void> {
  const started: string[] = []
  const released: string[] = []
  const graph = createCapabilityGraph()

  registerTracedStaticNode(graph, 'c', [{ provider: id('p'), required: true }], started, released)
  registerTracedStaticNode(graph, 'a', [], started, released)
  registerTracedStaticNode(graph, 'p', [], started, released)
  registerTracedStaticNode(graph, 'b', [], started, released)
  await graph.ready()
  expect(started).toEqual(['a', 'p', 'b', 'c'])
  await graph.dispose()
  expect(released).toEqual(['c', 'b', 'p', 'a'])
}

/** Covers the contract: freezes cycle diagnostic snapshots and preserves release cleanup primary. */
async function freezesCycleDiagnosticSnapshotsAndPreservesReleaseCleanupPrimary(): Promise<void> {
  const graph = createCapabilityGraph()
  graph.register({
    id: id('a'),
    kind: 'test',
    dependencies: [{ provider: id('b'), required: true }],
    start: readyInstance
  })
  graph.register({
    id: id('b'),
    kind: 'test',
    dependencies: [{ provider: id('a'), required: true }],
    start: () => instance(2)
  })
  await expect(graph.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.dependencyCycle
  })
  const detail = (graph.error as { detail: { path: string[] } }).detail
  expect(Object.isFrozen(detail)).toBe(true)
  expect(Object.isFrozen(detail.path)).toBe(true)

  const cleanupError = new Error('release cleanup')
  const abortGraph = createCapabilityGraph({
    onError: (error) => expect(walkErrorCauses(error).includes(cleanupError)).toBe(true)
  })
  abortGraph.register({
    id: id('abort'),
    kind: 'test',
    dependencies: [],
    start: () => failingStaticInstance(1, cleanupError)
  })
  await abortGraph.ready()
  let disposeError: unknown
  try {
    await abortGraph.dispose()
  } catch (error) {
    disposeError = error
  }
  expect(disposeError).toBe(abortGraph.error)
  expect(abortGraph.error).toBeInstanceOf(Error)
  expect(abortGraph.state).toBe(CapabilityGraphState.terminal)
  expect(abortGraph.error).toMatchObject({
    source: CAPABILITY_GRAPH_SOURCE,
    code: CapabilityGraphErrorCode.disposeFailed
  })
}

/** Covers the contract: exposes one reusable topology builder with stable derived levels. */
function exposesOneReusableTopologyBuilderWithStableDerivedLevels(): void {
  const nodes: ITopologyNode[] = [
    {
      id: id('consumer'),
      dependencies: [{ provider: id('provider'), required: true }],
      ordinal: 0
    },
    { id: id('provider'), dependencies: [], ordinal: 1 }
  ]
  const topology = buildCapabilityTopology(
    nodes,
    () => {
      throw new Error('unknown')
    },
    (path) => {
      throw new Error(path.join('>'))
    },
    () => {
      throw new Error('invalid')
    }
  )
  expect(topology.ordered.map((node) => node.id)).toEqual([id('provider'), id('consumer')])
  expect(topology.level.get(id('provider'))).toBe(0)
  expect(topology.level.get(id('consumer'))).toBe(1)
  expect(topology.providers.get(id('provider'))?.map((node) => node.id)).toEqual([id('consumer')])
  expect(topology.consumers.get(id('consumer'))).toEqual(nodes[0].dependencies)
  expect(topology.indegree.get(id('consumer'))).toBe(1)
  expect(topology.ordinal.get(id('consumer'))).toBe(0)
  expect(topology.ordinal.get(id('provider'))).toBe(1)
  expect(Object.isFrozen(topology)).toBe(true)

  const textSource = readFileSync(
    fileURLToPath(new URL('../../src/graph/error-text.ts', import.meta.url)),
    'utf8'
  )
  for (const key of Object.keys(CapabilityGraphErrorText)) {
    expect(textSource).toMatch(new RegExp(`\\/\\*\\*[\\s\\S]*?\\*\\/\\n  ${key}:`))
  }
  const graphSource = readStaticGraphSource()
  expect(graphSource).toContain(
    'Graph transaction state; node state remains a separate diagnostic axis.'
  )
  expect(graphSource).toContain('Canonical readiness promise shared by every caller.')
}

describe('capability graph-topology', () => {
  it(
    'settles a failed level and preserves ordinal primary plus secondary failures',
    settlesAFailedLevelAndPreservesOrdinalPrimaryPlusSecondaryFailures
  )

  it(
    'uses dependency topology before registration ordinal',
    usesDependencyTopologyBeforeRegistrationOrdinal
  )

  it(
    'snapshots onError once before lifecycle construction',
    snapshotsOnErrorOnceBeforeLifecycleConstruction
  )

  it(
    'starts disconnected nodes by stable registration ordinal',
    startsDisconnectedNodesByStableRegistrationOrdinal
  )

  it(
    'rejects cycles before user code and reports a stable path',
    rejectsCyclesBeforeUserCodeAndReportsAStablePath
  )

  it(
    'releases primary before auxiliary and in inverse topology',
    releasesPrimaryBeforeAuxiliaryAndInInverseTopology
  )

  it(
    'builds sparse topology through reverse adjacency without a full consumer scan',
    buildsSparseTopologyThroughReverseAdjacencyWithoutAFullConsumerScan
  )

  it(
    'uses level then ordinal startup and strict reverse release',
    usesLevelThenOrdinalStartupAndStrictReverseRelease
  )

  it(
    'freezes cycle diagnostic snapshots and preserves release cleanup primary',
    freezesCycleDiagnosticSnapshotsAndPreservesReleaseCleanupPrimary
  )

  it(
    'exposes one reusable topology builder with stable derived levels',
    exposesOneReusableTopologyBuilderWithStableDerivedLevels
  )
})
