import { describe, expect, it } from 'vitest'
import {
  createDynamicCapabilityGraph,
  type IDynamicGraphNodeDefinition
} from '../../src/graph/dynamic.js'
import type { IGraphNodeId } from '../../src/graph/index.js'

/** Creates a traced node with explicitly strong or optional provider edges. */
const node = (
  id: string,
  dependencies: readonly Readonly<{ readonly provider: string; readonly required: boolean }>[] = [],
  events: string[] = []
): IDynamicGraphNodeDefinition<string> => ({
  id: id as IGraphNodeId,
  kind: 'policy',
  dependencies: dependencies.map((dependency) => ({
    provider: dependency.provider as IGraphNodeId,
    required: dependency.required
  })),
  start: async () => {
    events.push(`start:${id}`)
    return {
      value: id,
      release: async () => {
        events.push(`release:${id}`)
      }
    }
  }
})

describe('dynamic dependency policy', () => {
  it('suspends without release and resumes the blocked frontier', async () => {
    const events: string[] = []
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('provider', [], events))
    await graph.register(node('consumer', [{ provider: 'provider', required: true }], events))
    events.length = 0

    await graph.suspend('provider' as IGraphNodeId)
    expect(graph.nodeState('provider' as IGraphNodeId).state).toBe('suspended')
    expect(graph.nodeState('consumer' as IGraphNodeId)).toMatchObject({
      state: 'blocked',
      reason: 'suspended'
    })
    expect(events).toEqual([])
    await graph.resume('provider' as IGraphNodeId)
    expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
    expect(events).toEqual([])
  })

  it('rejects required dependents atomically and preserves default cascade', async () => {
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('provider'))
    await graph.register(node('consumer', [{ provider: 'provider', required: true }]))
    await expect(
      graph.remove('provider' as IGraphNodeId, { policy: 'reject' })
    ).rejects.toMatchObject({ code: 'GRAPH_NODE_HAS_DEPENDENTS' })
    expect(graph.nodeState('provider' as IGraphNodeId).state).toBe('ready')
    expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
    await graph.remove('provider' as IGraphNodeId)
    expect(graph.nodeState('consumer' as IGraphNodeId)).toMatchObject({
      state: 'blocked',
      reason: 'removed'
    })
  })

  it('admits missing optional edges and reports direct dependents', async () => {
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('consumer', [{ provider: 'optional', required: false }]))
    expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
    await graph.register(node('optional'))
    expect(graph.dependentsOf('optional' as IGraphNodeId)).toEqual({
      required: [],
      optional: ['consumer']
    })
  })

  it('replaces without restarting dependents', async () => {
    const events: string[] = []
    const notified: string[] = []
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('provider', [], events))
    await graph.register(node('consumer', [{ provider: 'provider', required: true }], events))
    events.length = 0
    await graph.replace(node('provider', [], events), undefined, {
      restartDependents: false,
      onReplaced: (dependent) => {
        notified.push(String(dependent))
      }
    })
    expect(notified).toEqual(['consumer'])
    expect(events).toEqual(['release:provider', 'start:provider'])
  })

  it('reports a failed rebind and restarts only that dependent closure', async () => {
    const events: string[] = []
    const reported: unknown[] = []
    const hookFailure = new Error('rebind failed')
    const graph = createDynamicCapabilityGraph({ report: (error) => reported.push(error) })
    await graph.register(node('provider', [], events))
    await graph.register(node('consumer', [{ provider: 'provider', required: true }], events))
    await graph.register(node('leaf', [{ provider: 'consumer', required: true }], events))
    events.length = 0
    await graph.replace(node('provider', [], events), undefined, {
      restartDependents: false,
      onReplaced: () => {
        throw hookFailure
      }
    })
    expect(reported).toEqual([hookFailure])
    expect(events).toEqual([
      'release:provider',
      'start:provider',
      'release:leaf',
      'release:consumer',
      'start:consumer',
      'start:leaf'
    ])
  })

  it('restarts dependents when no rebind callback exists', async () => {
    const events: string[] = []
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('provider', [], events))
    await graph.register(node('consumer', [{ provider: 'provider', required: true }], events))
    events.length = 0
    await graph.replace(node('provider', [], events), undefined, { restartDependents: false })
    expect(events).toEqual([
      'release:provider',
      'start:provider',
      'release:consumer',
      'start:consumer'
    ])
  })

  it('keeps a diamond dependent blocked while another provider stays suspended', async () => {
    const graph = createDynamicCapabilityGraph()
    await graph.register(node('left'))
    await graph.register(node('right'))
    await graph.register(
      node('join', [
        { provider: 'left', required: true },
        { provider: 'right', required: true }
      ])
    )
    await graph.suspend('left' as IGraphNodeId)
    await graph.suspend('right' as IGraphNodeId)
    await graph.resume('left' as IGraphNodeId)
    expect(graph.nodeState('left' as IGraphNodeId).state).toBe('ready')
    expect(graph.nodeState('join' as IGraphNodeId)).toMatchObject({
      state: 'blocked',
      reason: 'suspended'
    })
    await graph.resume('right' as IGraphNodeId)
    expect(graph.nodeState('join' as IGraphNodeId).state).toBe('ready')
  })
})
