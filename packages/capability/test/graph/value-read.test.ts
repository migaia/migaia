import { expect, it } from 'vitest'
import {
  createCapabilityGraph,
  CapabilityGraphErrorCode,
  type IGraphNodeId
} from '@migaia/capability/graph'
import { releaseNothing } from './nonstatic-fixtures.js'

/**
 * Owns the isolated setup, action and assertions for: reads the canonical value without changing
 * frozen diagnostic snapshots or disposal visibility.
 */
async function verifyReadsTheCanonicalValueWithoutChangingFrozenDiagnosticSnapshotsOrDisposalVisibility() {
  /** Data identity belongs to the actual started node, never a Tray mirror. */
  const value = { count: 1 }
  /** One static node has no resource other than its original release callback. */
  const id = 'value' as IGraphNodeId
  /** Existing public factory owns all lifecycle state. */
  const graph = createCapabilityGraph()
  /** The original disposer must remain exactly once. */
  let releases = 0
  /** Primary resource owns the release observer without naming a local callback variable. */
  const primary = {
    value,
    release: (): void => {
      releases++
    }
  }
  graph.register({
    id,
    kind: 'value',
    dependencies: [],
    start: () => primary
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
}

/**
 * Owns the isolated setup, action and assertions for: permits a real undefined value and keeps
 * failed graphs unavailable.
 */
async function verifyPermitsARealUndefinedValueAndKeepsFailedGraphsUnavailable() {
  /** Undefined is a valid payload; graph readiness, not a sentinel, indicates availability. */
  const id = 'undefined' as IGraphNodeId
  /** This independent graph proves no undefined payload sentinel is introduced. */
  const graph = createCapabilityGraph()
  graph.register({
    id,
    kind: 'value',
    dependencies: [],
    start: () => ({ value: undefined, release: releaseNothing })
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
    start: () => ({ value: 1, release: releaseNothing })
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
}

/**
 * Owns the isolated setup, action and assertions for: preserves the existing unknown-node error
 * contract for direct value reads.
 */
function verifyPreservesTheExistingUnknownNodeErrorContractForDirectValueReads() {
  /** Lookup fails before any registration and retains the canonical native error surface. */
  const graph = createCapabilityGraph()
  expect(() => graph.readValue('missing' as IGraphNodeId)).toThrow(
    expect.objectContaining({
      source: 'capability.graph',
      code: CapabilityGraphErrorCode.unknownNode
    })
  )
}

it(
  'reads the canonical value without changing frozen diagnostic snapshots or disposal visibility',
  verifyReadsTheCanonicalValueWithoutChangingFrozenDiagnosticSnapshotsOrDisposalVisibility
)

it(
  'permits a real undefined value and keeps failed graphs unavailable',
  verifyPermitsARealUndefinedValueAndKeepsFailedGraphsUnavailable
)

it(
  'preserves the existing unknown-node error contract for direct value reads',
  verifyPreservesTheExistingUnknownNodeErrorContractForDirectValueReads
)
