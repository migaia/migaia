import { expect, it } from 'vitest'
import {
  createCapabilityGraph,
  CapabilityGraphErrorCode,
  type IGraphNodeId
} from '@migaia/capability/graph'

it('reads the canonical value without changing frozen diagnostic snapshots or disposal visibility', async () => {
  /** Data identity belongs to the actual started node, never a Tray mirror. */
  const value = { count: 1 }
  /** One static node has no resource other than its original release callback. */
  const id = 'value' as IGraphNodeId
  /** Existing public factory owns all lifecycle state. */
  const graph = createCapabilityGraph()
  /** The original disposer must remain exactly once. */
  let releases = 0
  graph.register({
    id,
    kind: 'value',
    dependencies: [],
    start: () => ({
      value,
      release: () => {
        releases++
      }
    })
  })
  /** Diagnostics remain point-in-time snapshots even though value reads allocate no projection. */
  const initial = graph.nodeState(id)
  expect(graph.readValue(id)).toBeUndefined()
  await graph.ready()
  expect(graph.readValue(id)).toBe(value)
  value.count = 2
  expect(graph.readValue<{ count: number }>(id)?.count).toBe(2)
  expect(initial.state).toBe('registered')
  expect(initial.value).toBeUndefined()
  expect(Object.isFrozen(initial)).toBe(true)
  await graph.dispose()
  expect(graph.readValue(id)).toBeUndefined()
  expect(releases).toBe(1)
})

it('permits a real undefined value and keeps failed graphs unavailable', async () => {
  /** Undefined is a valid payload; graph readiness, not a sentinel, indicates availability. */
  const id = 'undefined' as IGraphNodeId
  /** This independent graph proves no undefined payload sentinel is introduced. */
  const graph = createCapabilityGraph()
  graph.register({
    id,
    kind: 'value',
    dependencies: [],
    start: () => ({ value: undefined, release: () => undefined })
  })
  await graph.ready()
  expect(graph.state).toBe('ready')
  expect(graph.readValue(id)).toBeUndefined()
  await graph.dispose()
  /** A later startup failure must not expose an earlier node's value. */
  const failed = createCapabilityGraph()
  failed.register({
    id,
    kind: 'value',
    dependencies: [],
    start: () => ({ value: 1, release: () => undefined })
  })
  failed.register({
    id: 'bad' as IGraphNodeId,
    kind: 'value',
    dependencies: [],
    start: () => {
      throw new Error('expected startup failure')
    }
  })
  await expect(failed.ready()).rejects.toBeDefined()
  expect(failed.readValue(id)).toBeUndefined()
  await failed.dispose()
})

it('preserves the existing unknown-node error contract for direct value reads', () => {
  /** Lookup fails before any registration and retains the canonical native error surface. */
  const graph = createCapabilityGraph()
  expect(() => graph.readValue('missing' as IGraphNodeId)).toThrow(
    expect.objectContaining({
      source: '@migaia/capability/graph',
      code: CapabilityGraphErrorCode.unknownNode
    })
  )
})
