import { describe, expect, it } from 'vitest'
import {
  createDynamicCapabilityGraph,
  type IDynamicCapabilityGraph
} from '../../src/graph/dynamic.js'
import {
  CapabilityGraphErrorCode,
  type IGraphNodeDefinition,
  type IGraphNodeDiagnostic,
  type IGraphNodeId
} from '../../src/graph/index.js'
import { createTestBatchOwner } from '../fixtures/dynamic-batch-owner.js'

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
  it.each(['register', 'replace'] as const)(
    'snapshots %s getters once and preserves the original start receiver',
    async (operation) => {
      /** Count only caller accessors, independently of reads of the frozen admitted data. */
      const reads = { id: 0, kind: 0, dependencies: 0, start: 0, provider: 0, required: 0 }
      /** Mutating caller storage after admission must not rewrite graph identity or diagnostics. */
      let name = 'captured'
      let kind = 'test'
      /** Edge accessors share the canonical admission boundary with the topology index. */
      const dependencies = [
        {
          get provider() {
            reads.provider += 1
            return 'provider' as IGraphNodeId
          },
          get required(): true {
            reads.required += 1
            return true
          }
        }
      ]
      /** Private state makes a lost method receiver fail at the genuine node start. */
      class Definition {
        /** Value can only be read by invoking start with this original instance. */
        #value = 42
        get id() {
          reads.id += 1
          return name as IGraphNodeId
        }
        get kind() {
          reads.kind += 1
          return kind
        }
        get dependencies() {
          reads.dependencies += 1
          return dependencies
        }
        get start() {
          reads.start += 1
          return this.#start
        }
        /** Captured method retains the caller's receiver without a second start getter read. */
        #start() {
          return { value: this.#value, release: () => undefined }
        }
      }
      /** Real batch lifecycle ownership remains responsible for start and release. */
      const graph = createDynamicCapabilityGraph(createTestBatchOwner())
      await graph.register(node('provider'))
      if (operation === 'replace') await graph.register(node('captured', ['provider']))
      /** One caller-owned instance supplies every descriptor getter. */
      const definition = new Definition()
      if (operation === 'register') await graph.register(definition)
      else await graph.replace(definition)
      name = 'mutated'
      kind = 'mutated'
      dependencies.length = 0
      expect(graph.nodeState('captured' as IGraphNodeId)).toMatchObject({
        id: 'captured',
        kind: 'test',
        value: 42,
        state: 'ready'
      })
      expect(graph.dependentsOf('provider' as IGraphNodeId).required).toEqual(['captured'])
      await graph.dispose()
      expect(reads).toEqual({ id: 1, kind: 1, dependencies: 1, start: 1, provider: 1, required: 1 })
    }
  )

  it('codes a node getter failure before mutation while preserving its native identity', async () => {
    /** Exact original failure remains the thrown graph error after identity attachment. */
    const failure = new TypeError('node getter')
    /** Failed admission must leave this real dynamic graph usable for the next registration. */
    const graph = createDynamicCapabilityGraph(createTestBatchOwner())
    /** A valid descriptor apart from the getter that fails during admission. */
    const definition: IGraphNodeDefinition<string> = {
      get id(): IGraphNodeId {
        throw failure
      },
      kind: 'test',
      dependencies: [],
      start: () => ({ value: 'unused', release: () => undefined })
    }
    await expect(graph.register(definition)).rejects.toBe(failure)
    expect(failure).toMatchObject({ code: CapabilityGraphErrorCode.invalidNode })
    expect(graph.nodes).toEqual([])
    await graph.register(node('next'))
    expect(graph.nodes).toEqual(['next'])
    await graph.dispose()
  })

  it('seals the exact binding generation until every acquired lease releases', async () => {
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
      ...createTestBatchOwner<INodeBinding>(),
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
    const graph = createDynamicCapabilityGraph<INodeBinding>(createTestBatchOwner())
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
    const graph = createDynamicCapabilityGraph(createTestBatchOwner())
    await graph.register(node('provider'))
    await graph.register(node('consumer', ['provider']))
    expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
    await graph.dispose()
  })

  it('cascades removal and restarts only the blocked frontier', async () => {
    const events: string[] = []
    const graph: IDynamicCapabilityGraph = createDynamicCapabilityGraph(createTestBatchOwner())
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
    const graph = createDynamicCapabilityGraph(createTestBatchOwner())
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

  it('blocks the whole start batch with the original error when one start fails', async () => {
    let failDependent = false
    const graph = createDynamicCapabilityGraph(createTestBatchOwner())
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
    // Provider and dependent restart in one batch. The batch owner reports one failure, so the
    // graph cannot attribute it to a node and blocks the whole batch with the original error.
    const failure = await graph.register(node('provider')).then(
      () => undefined,
      (error: unknown) => error
    )
    expect(failure).toMatchObject({
      code: 'GRAPH_START_FAILED',
      detail: { nodes: ['provider', 'dependent'] }
    })
    for (const nodeId of ['provider', 'dependent'])
      expect(graph.nodeState(nodeId as IGraphNodeId)).toMatchObject({
        state: 'blocked',
        reason: 'failed',
        error: failure
      })
    await graph.dispose()
  })

  it('retains a failed replacement definition for explicit recovery', async () => {
    const graph = createDynamicCapabilityGraph(createTestBatchOwner())
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
    // A single-node batch attributes the failure to that node.
    expect(graph.nodeState('replaceable' as IGraphNodeId).state).toBe('failed')
    await graph.replace(node('replaceable'))
    expect(graph.nodeState('replaceable' as IGraphNodeId).state).toBe('ready')
    await graph.dispose()
  })

  it('preserves node identity on same-edge replacement across graph sizes', async () => {
    const states: IGraphNodeDiagnostic[] = []
    const sizes: number[] = []
    for (const unrelatedCount of [0, 1_000, 4_000, 8_000]) {
      const graph = createDynamicCapabilityGraph(createTestBatchOwner())
      await graph.register(node('provider'))
      await graph.register(node('consumer', ['provider']))
      for (let index = 0; index < unrelatedCount; index += 1)
        await graph.register(node(`unrelated-${index}`))
      const before = graph.nodeState('consumer' as IGraphNodeId)
      const result = await graph.replace(node('consumer', ['provider']))
      states.push(graph.nodeState('consumer' as IGraphNodeId))
      sizes.push(graph.nodes.length)
      expect(result.topologyChanged).toBe(false)
      expect(result.affected).toEqual(['consumer'])
      expect(result).not.toHaveProperty('metrics')
      expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
      expect(states.at(-1)?.ordinal).toBe(before.ordinal)
      expect(states.at(-1)?.rank).toBe(before.rank)
      expect(states.at(-1)?.level).toBe(before.level)
      await graph.dispose()
    }
    expect(sizes).toEqual([2, 1_002, 4_002, 8_002])
    expect(states.map(({ ordinal, rank, level }) => [ordinal, rank, level])).toEqual([
      [1, 1, 1],
      [1, 1_001, 1],
      [1, 4_001, 1],
      [1, 8_001, 1]
    ])
  })

  it('reconciles the affected frontier in large sparse and dense graphs', async () => {
    const samples: Array<{
      readonly size: number
      readonly backgroundNodes: number
      readonly dense: boolean
    }> = []
    for (const backgroundNodes of [1, 1_000, 2_000, 4_000, 8_000]) {
      for (const dense of [false, true]) {
        const graph = createDynamicCapabilityGraph(createTestBatchOwner())
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
        const result = await graph.replace(node('target'))
        samples.push({
          size: graph.nodes.length,
          backgroundNodes,
          dense
        })
        expect(result.affected).toEqual(expectedAffected)
        expect(result).not.toHaveProperty('metrics')
        for (const id of expectedAffected)
          expect(graph.nodeState(id as IGraphNodeId).state).toBe('ready')
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
  }, 20_000)
})
