import { describe, expect, it } from 'vitest'
import {
  createDynamicCapabilityGraph,
  type IDynamicCapabilityGraph,
  type IGraphMutationResult,
  type IGraphTraversalMetrics
} from '../../src/graph/dynamic.js'
import type {
  IGraphNodeDefinition,
  IGraphNodeDiagnostic,
  IGraphNodeId
} from '../../src/graph/index.js'

type INodeBinding = Readonly<{ readonly name: string }>

const node = (
  id: string,
  dependencies: readonly string[] = [],
  starts: string[] = []
): IGraphNodeDefinition<string> => ({
  id: id as IGraphNodeId,
  kind: 'test',
  dependencies: dependencies.map((provider) => ({
    provider: provider as IGraphNodeId,
    required: true as const
  })),
  start: async () => {
    starts.push(`start:${id}`)
    return {
      value: id,
      release: async () => {
        starts.push(`release:${id}`)
      }
    }
  }
})

describe('dynamic capability graph', () => {
  it('TPD-T55 seals the exact binding generation until every acquired lease releases', async () => {
    let fenceObserved = false
    const graph = createDynamicCapabilityGraph<INodeBinding>({
      startBatch: (entries) =>
        entries.map((entry) => ({ value: entry.binding, release: async () => undefined })),
      releaseBatch: async (_entries, fence) => {
        await fence
        fenceObserved = true
      }
    })
    await graph.register(node('leased'), { name: 'leased' })
    const lease = graph.acquireBinding('leased' as IGraphNodeId)
    const removing = graph.remove('leased' as IGraphNodeId)
    await Promise.resolve()
    expect(fenceObserved).toBe(false)
    expect(lease.value).toEqual({ name: 'leased' })
    lease.release()
    await removing
    expect(fenceObserved).toBe(true)
  })

  it('releases only the exact removed binding custody after instance cleanup', async () => {
    const custody: string[] = []
    const graph = createDynamicCapabilityGraph<INodeBinding>({
      startBatch: (entries) =>
        entries.map((entry) => ({ value: entry.binding, release: async () => undefined })),
      releaseBinding: ({ id, reason }) => {
        custody.push(`${String(id)}:${reason}`)
      }
    })
    await graph.register(node('provider'), { name: 'provider' })
    await graph.register(node('consumer', ['provider']), { name: 'consumer' })
    await graph.remove('provider' as IGraphNodeId)
    expect(custody).toEqual(['provider:remove'])
    await graph.dispose()
    expect(custody).toEqual(['provider:remove', 'consumer:dispose'])
  })

  it('retains missing-provider definitions as blocked and reconciles their frontier', async () => {
    const events: string[] = []
    const graph = createDynamicCapabilityGraph<INodeBinding>()
    await graph.register(node('consumer', ['provider'], events), { name: 'consumer' })
    expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('blocked')
    await graph.register(node('provider', [], events), { name: 'provider' })
    expect(graph.nodeState('provider' as IGraphNodeId).state).toBe('ready')
    expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
    expect(events).toEqual(['start:provider', 'start:consumer'])
    expect(graph.getBinding('consumer' as IGraphNodeId)).toEqual({ name: 'consumer' })
    await graph.dispose()
  })

  it('starts a newly registered consumer against an existing ready provider', async () => {
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('provider'))
    await graph.register(node('consumer', ['provider']))
    expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
    await graph.dispose()
  })

  it('cascades removal and restarts only the blocked frontier', async () => {
    const events: string[] = []
    const graph: IDynamicCapabilityGraph = createDynamicCapabilityGraph()
    await graph.register(node('provider', [], events))
    await graph.register(node('consumer', ['provider'], events))
    await graph.register(node('unrelated', [], events))
    events.length = 0
    const removal = await graph.remove('provider' as IGraphNodeId)
    expect(removal.affected).toEqual(['provider', 'consumer'])
    expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('blocked')
    expect(graph.nodeState('unrelated' as IGraphNodeId).state).toBe('ready')
    expect(events).toEqual(['release:consumer', 'release:provider'])
    await graph.register(node('provider', [], events))
    expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
    await graph.dispose()
  })

  it('rejects cyclic replacement before changing the existing generation', async () => {
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('a'))
    await graph.register(node('b', ['a']))
    const generation = graph.generation
    await expect(graph.replace(node('a', ['b']))).rejects.toMatchObject({
      code: 'GRAPH_DEPENDENCY_CYCLE'
    })
    expect(graph.generation).toBe(generation)
    expect(graph.nodeState('a' as IGraphNodeId).state).toBe('ready')
    await graph.dispose()
  })

  it('keeps a ready provider committed when a dependent restart fails', async () => {
    let failDependent = false
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('provider'))
    await graph.register({
      ...node('dependent', ['provider']),
      start: async (context) => {
        if (failDependent) throw new Error('dependent restart')
        return { value: context.get('provider' as IGraphNodeId), release: async () => {} }
      }
    })
    failDependent = true
    await graph.remove('provider' as IGraphNodeId)
    await expect(graph.register(node('provider'))).rejects.toMatchObject({
      code: 'GRAPH_START_FAILED'
    })
    expect(graph.nodeState('provider' as IGraphNodeId).state).toBe('ready')
    expect(graph.nodeState('dependent' as IGraphNodeId).state).toBe('failed')
    await graph.dispose()
  })

  it('retains a failed replacement definition for explicit recovery', async () => {
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('replaceable'))
    await expect(
      graph.replace({
        ...node('replaceable'),
        start: async () => {
          throw new Error('replacement')
        }
      })
    ).rejects.toMatchObject({ code: 'GRAPH_START_FAILED' })
    expect(graph.nodes).toContain('replaceable')
    expect(graph.nodeState('replaceable' as IGraphNodeId).state).toBe('failed')
    await graph.replace(node('replaceable'))
    expect(graph.nodeState('replaceable' as IGraphNodeId).state).toBe('ready')
    await graph.dispose()
  })

  it('TPD-T08 preserves node identity and bounded traversal on same-edge replacement', async () => {
    const samples: IGraphMutationResult[] = []
    const states: IGraphNodeDiagnostic[] = []
    const sizes: number[] = []
    for (const unrelatedCount of [0, 1_000, 4_000, 8_000]) {
      const graph = createDynamicCapabilityGraph()
      await graph.register(node('provider'))
      await graph.register(node('consumer', ['provider']))
      for (let index = 0; index < unrelatedCount; index += 1)
        await graph.register(node(`unrelated-${index}`))
      const before = graph.nodeState('consumer' as IGraphNodeId)
      const result = await graph.replace(node('consumer', ['provider']))
      samples.push(result)
      states.push(graph.nodeState('consumer' as IGraphNodeId))
      sizes.push(graph.nodes.length)
      expect(result.topologyChanged).toBe(false)
      expect(result.affected).toEqual(['consumer'])
      expect(result.metrics.fullScan).toBe(false)
      expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
      expect(states.at(-1)?.ordinal).toBe(before.ordinal)
      expect(states.at(-1)?.rank).toBe(before.rank)
      expect(states.at(-1)?.level).toBe(before.level)
      await graph.dispose()
    }
    expect(sizes).toEqual([2, 1_002, 4_002, 8_002])
    expect(samples.map(({ metrics }) => metrics.visitedNodes)).toEqual([1, 1, 1, 1])
    expect(samples.map(({ metrics }) => metrics.visitedEdges)).toEqual([1, 1, 1, 1])
    expect(samples.map(({ metrics }) => metrics.queueOperations)).toEqual([2, 2, 2, 2])
    expect(states.map(({ ordinal, rank, level }) => [ordinal, rank, level])).toEqual([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1]
    ])
  })

  it('TPD-T56 keeps large sparse and dense mutations on the affected frontier', async () => {
    const samples: Array<{
      readonly size: number
      readonly backgroundNodes: number
      readonly dense: boolean
      readonly vDelta: number
      readonly eDelta: number
      readonly visited: number
      readonly queue: number
      readonly queueTimeMs: number
      readonly metrics: IGraphTraversalMetrics
    }> = []
    for (const backgroundNodes of [1, 1_000, 2_000, 4_000, 8_000]) {
      for (const dense of [false, true]) {
        const graph = createDynamicCapabilityGraph()
        await graph.register(node('target'))
        const frontier = Array.from({ length: 32 }, (_, index) => `frontier-${index}`)
        for (const [index, id] of frontier.entries()) {
          const dependencies = dense
            ? [
                'target',
                ...Array.from(
                  { length: Math.min(8, index) },
                  (_, offset) => frontier[index - offset - 1]
                )
              ]
            : ['target']
          await graph.register(node(id, dependencies))
        }
        for (let index = 0; index < backgroundNodes; index += 1)
          await graph.register(node(`unrelated-${index}`))
        const expectedAffected = ['target', ...frontier]
        const expectedEdges = dense
          ? frontier.reduce((total, _id, index) => total + 1 + Math.min(8, index), 0)
          : frontier.length
        const result = await graph.replace(node('target'))
        samples.push({
          size: graph.nodes.length,
          backgroundNodes,
          dense,
          vDelta: result.metrics.visitedNodes,
          eDelta: result.metrics.visitedEdges,
          visited: result.metrics.visitedNodes,
          queue: result.metrics.queueOperations,
          queueTimeMs: result.metrics.queueTimeMs,
          metrics: result.metrics
        })
        expect(result.affected).toEqual(expectedAffected)
        expect(result.metrics.fullScan).toBe(false)
        expect(result.metrics.visitedNodes).toBe(expectedAffected.length)
        expect(result.metrics.visitedEdges).toBe(expectedEdges * 2)
        expect(result.metrics.queueOperations).toBe(expectedAffected.length * 2)
        expect(result.metrics.visitedNodes).toBeLessThanOrEqual(frontier.length + 1)
        expect(Number.isFinite(result.metrics.queueTimeMs)).toBe(true)
        expect(result.metrics.queueTimeMs).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(result.metrics.wallTimeMs)).toBe(true)
        await graph.dispose()
      }
    }
    expect(samples).toHaveLength(10)
    expect(samples.map(({ backgroundNodes }) => backgroundNodes)).toEqual([
      1, 1, 1_000, 1_000, 2_000, 2_000, 4_000, 4_000, 8_000, 8_000
    ])
    expect(samples.map(({ size }) => size)).toEqual([
      34, 34, 1_033, 1_033, 2_033, 2_033, 4_033, 4_033, 8_033, 8_033
    ])
    expect(samples.map(({ vDelta }) => vDelta)).toEqual(Array(10).fill(33))
    expect(samples.map(({ visited }) => visited)).toEqual(Array(10).fill(33))
    expect(samples.map(({ queue }) => queue)).toEqual(Array(10).fill(66))
    expect(samples.every(({ queueTimeMs }) => Number.isFinite(queueTimeMs))).toBe(true)
    expect(samples.every(({ queueTimeMs }) => queueTimeMs >= 0)).toBe(true)
    expect(samples.filter(({ dense }) => dense).map(({ eDelta }) => eDelta)).toEqual(
      Array(5).fill(504)
    )
    expect(samples.filter(({ dense }) => !dense).map(({ eDelta }) => eDelta)).toEqual(
      Array(5).fill(64)
    )
  }, 20_000)
})
