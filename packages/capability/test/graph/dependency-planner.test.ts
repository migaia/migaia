import { describe, expect, it } from 'vitest'
import {
  DependencyAction,
  DependencyMutationKind,
  DependencyNodeStatus,
  DependencyPolicy,
  planActivation,
  planDependencyMutation,
  planReplacement,
  planRestart,
  planResume,
  planTeardown,
  resolveInstallSet,
  type IDependencyPlan,
  type IDependencyStatusReader
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

/** Creates a stable status reader over the supplied node-state entries. */
function statuses(
  entries: Readonly<
    Record<string, (typeof DependencyNodeStatus)[keyof typeof DependencyNodeStatus]>
  >
): IDependencyStatusReader {
  return (id) => entries[id] ?? DependencyNodeStatus.active
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

describe('dependency planner', () => {
  it('A7 plans reject, cascade, and suspend dependency mutations', () => {
    const index = createTestIndex()
    index.add({ id: 'p', dependencies: [] })
    index.add({ id: 'a', dependencies: [{ provider: 'p', required: true }] })
    index.add({ id: 'b', dependencies: [{ provider: 'a', required: true }] })
    index.add({ id: 'c', dependencies: [{ provider: 'p', required: false }] })
    index.add({ id: 'l', dependencies: [{ provider: 'p', required: true }] })
    const readStatus = statuses({ l: DependencyNodeStatus.inactive })

    const rejected = planDependencyMutation(index, readStatus, {
      roots: ['p'],
      kind: DependencyMutationKind.remove,
      policy: DependencyPolicy.reject
    })
    expect(rejected.blockedBy).toEqual(['b', 'l', 'a'])
    expect(rejected.steps).toEqual([])

    const cascaded = planDependencyMutation(index, readStatus, {
      roots: ['p'],
      kind: DependencyMutationKind.remove,
      policy: DependencyPolicy.cascade
    })
    expect(cascaded.order).toEqual(['b', 'l', 'a', 'p'])
    expect(cascaded.steps.every((step) => step.action === DependencyAction.release)).toBe(true)

    const suspended = planDependencyMutation(index, readStatus, {
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

    const disabled = planDependencyMutation(index, readStatus, {
      roots: ['p'],
      kind: DependencyMutationKind.disable,
      policy: DependencyPolicy.suspend
    })
    expect(disabled.steps.at(-1)).toEqual({ id: 'p', action: DependencyAction.disable })

    expect(() =>
      planDependencyMutation(index, readStatus, {
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
    const readStatus = statuses({ l: DependencyNodeStatus.inactive })

    expect(
      planReplacement(index, readStatus, {
        target: 'p',
        canRebind: (id) => id === 'a'
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.rebind },
      { id: 'd', action: DependencyAction.restart },
      { id: 'b', action: DependencyAction.restart }
    ])
    expect(planRestart(index, readStatus, ['a']).steps).toEqual([
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
    const readStatus = statuses({
      a: DependencyNodeStatus.suspended,
      b: DependencyNodeStatus.suspended,
      e: DependencyNodeStatus.suspended
    })

    expect(
      planResume(index, readStatus, {
        provider: 'p',
        generationChanged: true,
        canRebind: () => false
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.restart },
      { id: 'b', action: DependencyAction.restart }
    ])
    expect(
      planResume(index, readStatus, {
        provider: 'p',
        generationChanged: true,
        canRebind: (id) => id === 'a'
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.rebind },
      { id: 'b', action: DependencyAction.resume }
    ])
    expect(
      planResume(index, readStatus, {
        provider: 'p',
        generationChanged: false,
        canRebind: () => false
      }).steps
    ).toEqual([
      { id: 'a', action: DependencyAction.resume },
      { id: 'b', action: DependencyAction.resume }
    ])
  })

  it('A10 plans lazy activation, install membership, and inverse teardown', () => {
    const index = createTestIndex()
    index.add({ id: 'l1', dependencies: [] })
    index.add({ id: 'l2', dependencies: [{ provider: 'l1', required: true }] })
    index.add({ id: 'e', dependencies: [{ provider: 'l2', required: true }] })
    index.add({ id: 'l3', dependencies: [] })
    const readStatus = statuses({
      l1: DependencyNodeStatus.inactive,
      l2: DependencyNodeStatus.inactive,
      l3: DependencyNodeStatus.inactive
    })

    expect(planActivation(index, readStatus, ['e']).steps).toEqual([
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
    const plan = planDependencyMutation(index, statuses({}), {
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
      const plan = planDependencyMutation(index, statuses({}), {
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
})
