import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  DependencyAction,
  DependencyMutationKind,
  DependencyPolicy,
  planActivation,
  planDependencyMutation,
  planReplacement,
  planRestart,
  planResume,
  planTeardown,
  resolveInstallSet,
  type IDependencyNodeState,
  type IDependencyPlan,
  type IDependencyStateReader
} from '../../src/graph/dependency.js'
import {
  createTopologyIndex,
  type ICapabilityTopology,
  type ITopologyIndex
} from '../../src/graph/topology.js'

/** Creates a topology index whose structural errors remain directly inspectable. */
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

/** Default planner state for an activated provider that currently serves dependents. */
const servingState: IDependencyNodeState = Object.freeze({
  activated: true,
  enabled: true,
  suspended: false,
  stale: false
})

/** Creates a stable state reader over per-node overrides of the serving state. */
function states(
  entries: Readonly<Record<string, Partial<IDependencyNodeState>>>
): IDependencyStateReader {
  return (id) => Object.freeze({ ...servingState, ...entries[id] })
}

/** Converts a snapshot into ordinary data for mutation-free planner assertions. */
function projectSnapshot(topology: ICapabilityTopology): unknown {
  return {
    ordered: topology.ordered.map((node) => node.id),
    providers: [...topology.providers].map(([id, nodes]) => [id, nodes.map((node) => node.id)]),
    consumers: [...topology.consumers],
    indegree: [...topology.indegree],
    level: [...topology.level],
    ordinal: [...topology.ordinal]
  }
}

/** Attempts representative mutations against every deeply frozen plan surface. */
function mutatePlan(plan: IDependencyPlan): void {
  ;(plan.steps as Array<{ id: string; action: string }>).push({ id: 'x', action: 'release' })
}

/** Builds one service chain plus an optional fixed-size suspended direct frontier. */
function createResumeFixture(
  length: number,
  suspendedDirect = 0
): Readonly<{ index: ITopologyIndex; state: IDependencyStateReader }> {
  const index = createTestIndex()
  index.add({ id: 'p', dependencies: [] })
  for (let position = 0; position < length; position += 1)
    index.add({
      id: `chain-${position}`,
      dependencies: [{ provider: position === 0 ? 'p' : `chain-${position - 1}`, required: true }]
    })
  /** Suspended direct dependents used to prove traversal ignores the service chain. */
  const entries: Record<string, Partial<IDependencyNodeState>> = {}
  for (let position = 0; position < suspendedDirect; position += 1) {
    const id = `suspended-${position}`
    index.add({ id, dependencies: [{ provider: 'p', required: true }] })
    entries[id] = { suspended: true }
  }
  return { index, state: states(entries) }
}

/** Returns the median duration of three 1000-call resume-planning runs. */
function measureResumeMs(fixture: ReturnType<typeof createResumeFixture>): number {
  /** Three independent elapsed durations used to discard one scheduling outlier. */
  const samples: number[] = []
  for (let run = 0; run < 3; run += 1) {
    const startedAt = performance.now()
    for (let iteration = 0; iteration < 1_000; iteration += 1)
      planResume(fixture.index, fixture.state, {
        provider: 'p',
        generationChanged: true,
        canRebind: () => false
      })
    samples.push(performance.now() - startedAt)
  }
  return samples.sort((left, right) => left - right)[1]!
}

describe('dependency planner', () => {
  it('A7 plans reject, cascade, and suspend dependency mutations', () => {
    const index = createTestIndex()
    index.add({ id: 'p', dependencies: [] })
    index.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 'b', dependencies: [{ provider: 'a', required: true }] })
    index.add({ id: 'c', dependencies: [{ provider: 'p', required: false }] })
    index.add({ id: 'l', dependencies: [{ provider: 'p', required: true }] })
    const readState = states({ l: { activated: false } })

    const rejected = planDependencyMutation(index, readState, {
      roots: ['p'],
      kind: DependencyMutationKind.remove,
      policy: DependencyPolicy.reject
    })
    expect(rejected.blockedBy).toEqual(['b', 'l', 'a'])
    expect(rejected.steps).toEqual([])

    const cascaded = planDependencyMutation(index, readState, {
      roots: ['p'],
      kind: DependencyMutationKind.remove,
      policy: DependencyPolicy.cascade
    })
    expect(cascaded.order).toEqual(['b', 'l', 'a', 'p'])
    expect(cascaded.steps.every((step) => step.action === DependencyAction.release)).toBe(true)

    const suspended = planDependencyMutation(index, readState, {
      roots: ['p'],
      kind: DependencyMutationKind.remove,
      policy: DependencyPolicy.suspend
    })
    expect(suspended.steps).toEqual([
      { id: 'b', action: DependencyAction.suspend },
      { id: 'a', action: DependencyAction.suspend },
      { id: 'p', action: DependencyAction.release }
    ])
    expect(suspended.edges).toContainEqual({ provider: 'p', consumer: 'c', optional: true })

    const disabled = planDependencyMutation(index, readState, {
      roots: ['p'],
      kind: DependencyMutationKind.disable,
      policy: DependencyPolicy.suspend
    })
    expect(disabled.steps.at(-1)).toEqual({ id: 'p', action: DependencyAction.disable })

    expect(() =>
      planDependencyMutation(index, readState, {
        roots: ['p'],
        kind: DependencyMutationKind.remove,
        policy: 'unknown' as never
      })
    ).toThrow(expect.objectContaining({ code: 'GRAPH_INVALID_OPTION' }))
    expect(() =>
      planDependencyMutation(
        index,
        () => {
          throw new Error('status sentinel')
        },
        {
          roots: ['p'],
          kind: DependencyMutationKind.remove,
          policy: DependencyPolicy.suspend
        }
      )
    ).toThrow('status sentinel')
  })

  it('A8 separates direct rebinds from dependent-first restart closure', () => {
    const index = createTestIndex()
    index.add({ id: 'p', dependencies: [] })
    index.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 'b', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 'l', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 'd', dependencies: [{ provider: 'b', required: true }] })
    const readState = states({ l: { activated: false } })

    expect(
      planReplacement(index, readState, {
        target: 'p',
        canRebind: (id) => id === 'a'
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.rebind },
      { id: 'd', action: DependencyAction.restart },
      { id: 'b', action: DependencyAction.restart }
    ])
    expect(planRestart(index, readState, ['a']).steps).toEqual([
      { id: 'a', action: DependencyAction.restart }
    ])
  })

  it('A9 resumes only satisfiable suspended closures with generation-aware actions', () => {
    const index = createTestIndex()
    index.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 'b', dependencies: [{ provider: 'a', required: true }] })
    index.add({
      id: 'e',
      dependencies: [
        { provider: 'p', required: true },
        { provider: 'q', required: true }
      ]
    })
    index.add({ id: 'p', dependencies: [] })
    const readState = states({
      a: { suspended: true },
      b: { suspended: true },
      e: { suspended: true }
    })

    expect(
      planResume(index, readState, {
        provider: 'p',
        generationChanged: true,
        canRebind: () => false
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.restart },
      { id: 'b', action: DependencyAction.restart }
    ])
    expect(
      planResume(index, readState, {
        provider: 'p',
        generationChanged: true,
        canRebind: (id) => id === 'a'
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.rebind },
      { id: 'b', action: DependencyAction.resume }
    ])
    expect(
      planResume(index, readState, {
        provider: 'p',
        generationChanged: false,
        canRebind: () => false
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.resume },
      { id: 'b', action: DependencyAction.resume }
    ])
    expect(
      planResume(index, states({ a: { suspended: true, stale: true }, b: { suspended: true } }), {
        provider: 'p',
        generationChanged: true,
        canRebind: () => true
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.restart },
      { id: 'b', action: DependencyAction.restart }
    ])
  })

  it('A10 plans lazy activation, install membership, and inverse teardown', () => {
    const index = createTestIndex()
    index.add({ id: 'l1', dependencies: [] })
    index.add({ id: 'l2', dependencies: [{ provider: 'l1', required: true }] })
    index.add({ id: 'e', dependencies: [{ provider: 'l2', required: true }] })
    index.add({ id: 'l3', dependencies: [] })
    const readState = states({
      l1: { activated: false },
      l2: { activated: false },
      l3: { activated: false }
    })

    expect(planActivation(index, readState, ['e']).steps).toEqual([
      { id: 'l1', action: DependencyAction.activate },
      { id: 'l2', action: DependencyAction.activate }
    ])
    expect([...resolveInstallSet(index, ['l1', 'l2', 'e'], (id) => id.startsWith('l'))]).toEqual([
      'l1',
      'l2',
      'e'
    ])
    expect([...resolveInstallSet(index, ['l3'], () => true)]).toEqual([])
    expect(planTeardown(index).order).toEqual([...index.order()].reverse())
  })

  it('A11 deeply freezes plans and leaves the index unchanged', () => {
    const index = createTestIndex()
    index.add({ id: 'p', dependencies: [] })
    index.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
    const before = projectSnapshot(index.snapshot())
    const plan = planDependencyMutation(index, states({}), {
      roots: ['p'],
      kind: DependencyMutationKind.remove,
      policy: DependencyPolicy.cascade
    })

    expect(() => mutatePlan(plan)).toThrow(TypeError)
    expect(() => {
      ;(plan.steps[0] as { id: string }).id = 'changed'
    }).toThrow(TypeError)
    expect(() => {
      ;(plan.edges as unknown as Array<{ provider: string }>).push({ provider: 'changed' })
    }).toThrow(TypeError)
    expect(projectSnapshot(index.snapshot())).toEqual(before)
  })

  it('A7 plans a leaf mutation without reading nodes outside its neighbourhood', () => {
    /** Metric deltas of one leaf plan per background size. */
    const deltas: Array<readonly [number, number]> = []
    for (const background of [1_000, 8_000]) {
      const index = createTestIndex()
      index.add({ id: 'p', dependencies: [] })
      index.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
      index.add({ id: 'c', dependencies: [{ provider: 'p', required: false }] })
      for (let position = 0; position < background; position += 1)
        index.add({ id: `unrelated-${position}`, dependencies: [] })
      const before = index.metrics()
      const plan = planDependencyMutation(index, states({}), {
        roots: ['a'],
        kind: DependencyMutationKind.remove,
        policy: DependencyPolicy.cascade
      })
      const after = index.metrics()
      expect(plan.order).toEqual(['a'])
      deltas.push([
        after.visitedNodes - before.visitedNodes,
        after.visitedEdges - before.visitedEdges
      ])
    }
    // An O(nodes) edge scan would grow with the background; the neighbourhood read does not.
    expect(deltas[1]).toEqual(deltas[0])
    expect(deltas[0]![0]).toBeLessThanOrEqual(8)
  })

  it('A14 reads disabled and suspended as orthogonal state flags', () => {
    const index = createTestIndex()
    index.add({ id: 'p', dependencies: [] })
    index.add({ id: 'm', dependencies: [{ provider: 'p', required: true }] })

    expect(
      planDependencyMutation(index, states({ m: { enabled: false, suspended: true } }), {
        roots: ['p'],
        kind: DependencyMutationKind.remove,
        policy: DependencyPolicy.suspend
      }).steps
    ).toEqual([{ id: 'p', action: DependencyAction.release }])
    expect(
      planDependencyMutation(index, states({ m: { enabled: false } }), {
        roots: ['p'],
        kind: DependencyMutationKind.remove,
        policy: DependencyPolicy.suspend
      }).steps
    ).toEqual([
      { id: 'm', action: DependencyAction.suspend },
      { id: 'p', action: DependencyAction.release }
    ])
  })

  it('A15 resumes a provider without serving through a disabled recovered node', () => {
    const index = createTestIndex()
    index.add({ id: 'p', dependencies: [] })
    index.add({ id: 'm', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 's', dependencies: [{ provider: 'm', required: true }] })
    /** Request shape shared by the three state projections. */
    const request = {
      provider: 'p',
      generationChanged: false,
      canRebind: () => false
    } as const

    expect(
      planResume(
        index,
        states({ m: { enabled: false, suspended: true }, s: { suspended: true } }),
        request
      ).steps
    ).toEqual([{ id: 'm', action: DependencyAction.resume }])
    expect(
      planResume(index, states({ m: { suspended: true }, s: { suspended: true } }), {
        ...request,
        provider: 'm'
      }).steps
    ).toEqual([
      { id: 'm', action: DependencyAction.resume },
      { id: 's', action: DependencyAction.resume }
    ])
    expect(
      planResume(index, states({ s: { suspended: true } }), { ...request, provider: 'm' }).steps
    ).toEqual([{ id: 's', action: DependencyAction.resume }])
  })

  it('A16 invalidates suspended bindings and restarts disabled consumers', () => {
    const index = createTestIndex()
    index.add({ id: 'p', dependencies: [] })
    index.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 'd', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 'x', dependencies: [{ provider: 'p', required: true }] })
    index.add({
      id: 'y',
      dependencies: [
        { provider: 'd', required: true },
        { provider: 'q', required: true }
      ]
    })
    const readState = states({
      d: { enabled: false },
      x: { suspended: true },
      y: { suspended: true }
    })

    expect(
      planReplacement(index, readState, {
        target: 'p',
        canRebind: (id) => id === 'a'
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.rebind },
      { id: 'x', action: DependencyAction.invalidate },
      { id: 'y', action: DependencyAction.invalidate },
      { id: 'd', action: DependencyAction.restart }
    ])
    expect(planRestart(index, readState, ['d']).steps).toEqual([
      { id: 'y', action: DependencyAction.invalidate },
      { id: 'd', action: DependencyAction.restart }
    ])
    expect(
      planResume(index, states({ x: { suspended: true, stale: true } }), {
        provider: 'p',
        generationChanged: true,
        canRebind: () => true
      }).steps
    ).toContainEqual({ id: 'x', action: DependencyAction.restart })
  })

  it('A17 bounds empty and suspended-frontier resume work', () => {
    const small = createResumeFixture(100)
    const large = createResumeFixture(2_000)
    /** Metric deltas for empty plans at both service-chain sizes. */
    const emptyDeltas = [small, large].map((fixture) => {
      const before = fixture.index.metrics()
      const plan = planResume(fixture.index, fixture.state, {
        provider: 'p',
        generationChanged: true,
        canRebind: () => false
      })
      const after = fixture.index.metrics()
      expect(plan.steps).toEqual([])
      return [
        after.visitedNodes - before.visitedNodes,
        after.visitedEdges - before.visitedEdges
      ] as const
    })
    expect(emptyDeltas[1]).toEqual(emptyDeltas[0])

    const smallDuration = measureResumeMs(small)
    const largeDuration = measureResumeMs(large)
    expect(largeDuration).toBeLessThanOrEqual(smallDuration * 2)

    /** Same suspended direct frontier attached to differently sized service chains. */
    const frontierDeltas = [createResumeFixture(100, 3), createResumeFixture(2_000, 3)].map(
      (fixture) => {
        const before = fixture.index.metrics()
        planResume(fixture.index, fixture.state, {
          provider: 'p',
          generationChanged: true,
          canRebind: () => true
        })
        const after = fixture.index.metrics()
        return [
          after.visitedNodes - before.visitedNodes,
          after.visitedEdges - before.visitedEdges
        ] as const
      }
    )
    expect(frontierDeltas[1]).toEqual(frontierDeltas[0])
  })
  it('A18 plans activation without walking activated ancestors', () => {
    /** Builds an activated chain of the given length, then three inactive lazy providers and a root. */
    const fixture = (size: number) => {
      const index = createTestIndex()
      for (let position = 0; position < size; position += 1)
        index.add({
          id: `c-${position}`,
          dependencies: position === 0 ? [] : [{ provider: `c-${position - 1}`, required: true }]
        })
      index.add({ id: 'l1', dependencies: [{ provider: `c-${size - 1}`, required: true }] })
      index.add({ id: 'l2', dependencies: [{ provider: 'l1', required: true }] })
      index.add({ id: 'l3', dependencies: [{ provider: 'l2', required: true }] })
      index.add({ id: 'root', dependencies: [{ provider: 'l3', required: true }] })
      return {
        index,
        state: states({
          l1: { activated: false },
          l2: { activated: false },
          l3: { activated: false }
        })
      }
    }
    /** Index work and resulting steps of one activation plan at one chain length. */
    const measure = (size: number) => {
      const { index, state } = fixture(size)
      const before = index.metrics()
      const plan = planActivation(index, state, ['root'])
      const after = index.metrics()
      return {
        steps: plan.steps.map((step) => `${step.id}:${step.action}`),
        work: [after.visitedNodes - before.visitedNodes, after.visitedEdges - before.visitedEdges]
      }
    }
    const small = measure(100)
    const large = measure(2_000)
    expect(small.steps).toEqual(['l1:activate', 'l2:activate', 'l3:activate'])
    expect(large.steps).toEqual(small.steps)
    // Work is bounded by the inactive frontier, not by the activated ancestry above it.
    expect(large.work).toEqual(small.work)
  })
})
