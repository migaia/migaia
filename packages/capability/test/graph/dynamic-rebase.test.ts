import { describe, expect, it } from 'vitest'
import {
  createDynamicCapabilityGraph,
  type IDynamicGraphNodeDefinition
} from '../../src/graph/dynamic.js'
import type { IGraphNodeId } from '../../src/graph/index.js'

/** Builds one traced node for the canonical-order dynamic rebase oracle. */
function node(
  id: string,
  dependencies: readonly string[],
  events: string[],
  canStart: () => boolean = () => true
): IDynamicGraphNodeDefinition<string> {
  return {
    id: id as IGraphNodeId,
    kind: 'dynamic-rebase',
    dependencies: dependencies.map((provider) => ({
      provider: provider as IGraphNodeId,
      required: true
    })),
    start: async () => {
      if (!canStart()) throw new Error(`blocked:${id}`)
      events.push(`start:${id}`)
      return {
        value: id,
        release: async () => {
          events.push(`release:${id}`)
        }
      }
    }
  }
}

describe('dynamic topology-index rebase', () => {
  it('A12 uses canonical frontiers while preserving dependency policies', async () => {
    /** Observable startup and release sequence across the rebase boundary. */
    const events: string[] = []
    let startEnabled = false
    const graph = createDynamicCapabilityGraph()
    await expect(graph.register(node('A', [], events, () => startEnabled))).rejects.toMatchObject({
      code: 'GRAPH_START_FAILED'
    })
    await graph.register(node('B', ['A'], events, () => startEnabled))
    await expect(graph.register(node('C', [], events, () => startEnabled))).rejects.toMatchObject({
      code: 'GRAPH_START_FAILED'
    })
    await graph.register(node('D', ['B'], events, () => startEnabled))
    startEnabled = true
    await graph.ready()
    expect(events).toEqual(['start:A', 'start:C', 'start:B', 'start:D'])
    events.length = 0

    await graph.dispose()
    expect(events).toEqual(['release:D', 'release:B', 'release:C', 'release:A'])

    /** Fresh graph isolates removal policy from the terminal startup oracle. */
    const removalEvents: string[] = []
    const removalGraph = createDynamicCapabilityGraph()
    await removalGraph.register(node('A', [], removalEvents))
    await removalGraph.register(node('B', ['A'], removalEvents))
    await removalGraph.register(node('C', [], removalEvents))
    await removalGraph.register(node('D', ['B'], removalEvents))
    removalEvents.length = 0

    await expect(
      removalGraph.remove('A' as IGraphNodeId, { policy: 'reject' })
    ).rejects.toMatchObject({
      code: 'GRAPH_NODE_HAS_DEPENDENTS',
      detail: { dependents: ['B'] }
    })
    await removalGraph.remove('A' as IGraphNodeId)
    expect(removalEvents).toEqual(['release:D', 'release:B', 'release:A'])
  })
})
