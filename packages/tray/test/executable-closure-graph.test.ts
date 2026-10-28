import { describe, expect, it } from 'vitest'
import { createDynamicCapabilityGraph } from '@migaia/capability/graph/dynamic'
import { graphId, graphNode, graphBatch, type IRuntimeCase } from './executable-closure-helper.ts'

const runtimeCases: readonly IRuntimeCase[] = [
  {
    id: 'readies a graph consumer after its provider',
    run: async () => {
      const graph = createDynamicCapabilityGraph(graphBatch)
      await graph.register(graphNode('provider'))
      await graph.register(graphNode('consumer', ['provider']))
      await graph.ready()
      expect(graph.nodeState(graphId('consumer')).state).toBe('ready')
      await graph.dispose()
    }
  },
  {
    id: 'rejects a self-dependent graph node',
    run: async () => {
      const graph = createDynamicCapabilityGraph(graphBatch)
      await expect(graph.register(graphNode('invalid', ['invalid']))).rejects.toBeDefined()
      expect(graph.nodes).toEqual([])
      await graph.dispose()
    }
  },
  {
    id: 'replaces a graph node value without topology change',
    run: async () => {
      const graph = createDynamicCapabilityGraph(graphBatch)
      await graph.register(graphNode('one', [], 1))
      await graph.ready()
      const result = await graph.replace(graphNode('one', [], 2))
      expect(result.topologyChanged).toBe(false)
      expect(result.affected).toEqual(['one'])
      expect(graph.nodeState(graphId('one')).value).toBe(2)
      await graph.dispose()
    }
  },
  {
    id: 'limits registration impact to the new dependent',
    run: async () => {
      const graph = createDynamicCapabilityGraph(graphBatch)
      await graph.register(graphNode('one'))
      await graph.register(graphNode('unrelated'))
      const result = await graph.register(graphNode('two', ['one']))
      expect(result.affected).toEqual(['two'])
      expect(graph.nodeState(graphId('two')).state).toBe('ready')
      expect(graph.nodeState(graphId('unrelated')).state).toBe('ready')
      await graph.dispose()
    }
  },
  {
    id: 'orders graph nodes by registration',
    run: async () => {
      const graph = createDynamicCapabilityGraph(graphBatch)
      await graph.register(graphNode('one'))
      await graph.register(graphNode('two', ['one']))
      expect(graph.nodes).toEqual(['one', 'two'])
      await graph.dispose()
    }
  },
  {
    id: 'keeps independent graph registrations in order',
    run: async () => {
      const graph = createDynamicCapabilityGraph(graphBatch)
      await graph.register(graphNode('first'))
      await graph.register(graphNode('second'))
      expect(graph.nodes).toEqual(['first', 'second'])
      await graph.dispose()
    }
  }
]

describe('executable Tray Host and Graph acceptance oracles', () => {
  it.each(runtimeCases)('$id', async ({ run }) => {
    await run()
  })
})
