import { describe, expect, it } from 'vitest'
import {
  createDynamicCapabilityGraph,
  type IDynamicGraphNodeDefinition
} from '../../src/graph/dynamic.ts'
import type { IGraphNodeId } from '../../src/graph/index.ts'
import { createTestBatchOwner } from '../fixtures/dynamic-batch-owner.ts'
import { tracedInstance } from './nonstatic-fixtures.ts'

/** Creates a traced node with explicitly strong or optional provider edges. */
const node = (
  id: string,
  dependencies: readonly Readonly<{ readonly provider: string; readonly required: boolean }>[] = [],
  events: string[] = []
): IDynamicGraphNodeDefinition<string> => {
  return {
    id: id as IGraphNodeId,
    kind: 'policy',
    dependencies: dependencies.map((dependency) => ({
      provider: dependency.provider as IGraphNodeId,
      required: dependency.required
    })),
    start: async () => {
      events.push(`start:${id}`)
      return tracedInstance(id, events)
    }
  }
}

/**
 * Owns the isolated setup, action and assertions for: suspends without release and resumes the
 * blocked frontier.
 */
async function verifySuspendsWithoutReleaseAndResumesTheBlockedFrontier() {
  const events: string[] = []
  const graph = createDynamicCapabilityGraph(createTestBatchOwner())
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
}

/**
 * Owns the isolated setup, action and assertions for: rejects required dependents atomically and
 * preserves default cascade.
 */
async function verifyRejectsRequiredDependentsAtomicallyAndPreservesDefaultCascade() {
  const graph = createDynamicCapabilityGraph(createTestBatchOwner())
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
}

/**
 * Owns the isolated setup, action and assertions for: admits missing optional edges and reports
 * direct dependents.
 */
async function verifyAdmitsMissingOptionalEdgesAndReportsDirectDependents() {
  const graph = createDynamicCapabilityGraph(createTestBatchOwner())
  await graph.register(node('consumer', [{ provider: 'optional', required: false }]))
  expect(graph.nodeState('consumer' as IGraphNodeId).state).toBe('ready')
  await graph.register(node('optional'))
  expect(graph.dependentsOf('optional' as IGraphNodeId)).toEqual({
    required: [],
    optional: ['consumer']
  })
}

/** Owns the isolated setup, action and assertions for: replaces without restarting dependents. */
async function verifyReplacesWithoutRestartingDependents() {
  const events: string[] = []
  const notified: string[] = []
  const graph = createDynamicCapabilityGraph(createTestBatchOwner())
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
}

/**
 * Owns the isolated setup, action and assertions for: reports a failed rebind and restarts only
 * that dependent closure.
 */
async function verifyReportsAFailedRebindAndRestartsOnlyThatDependentClosure() {
  const events: string[] = []
  const reported: unknown[] = []
  const hookFailure = new Error('rebind failed')
  const graph = createDynamicCapabilityGraph({
    ...createTestBatchOwner((error) => reported.push(error)),
    report: (error) => reported.push(error)
  })
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
}

/**
 * Owns the isolated setup, action and assertions for: restarts dependents when no rebind callback
 * exists.
 */
async function verifyRestartsDependentsWhenNoRebindCallbackExists() {
  const events: string[] = []
  const graph = createDynamicCapabilityGraph(createTestBatchOwner())
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
}

/**
 * Owns the isolated setup, action and assertions for: keeps a diamond dependent blocked while
 * another provider stays suspended.
 */
async function verifyKeepsADiamondDependentBlockedWhileAnotherProviderStaysSuspended() {
  const graph = createDynamicCapabilityGraph(createTestBatchOwner())
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
}

describe('dynamic dependency policy', () => {
  it(
    'suspends without release and resumes the blocked frontier',
    verifySuspendsWithoutReleaseAndResumesTheBlockedFrontier
  )

  it(
    'rejects required dependents atomically and preserves default cascade',
    verifyRejectsRequiredDependentsAtomicallyAndPreservesDefaultCascade
  )

  it(
    'admits missing optional edges and reports direct dependents',
    verifyAdmitsMissingOptionalEdgesAndReportsDirectDependents
  )

  it('replaces without restarting dependents', verifyReplacesWithoutRestartingDependents)

  it(
    'reports a failed rebind and restarts only that dependent closure',
    verifyReportsAFailedRebindAndRestartsOnlyThatDependentClosure
  )

  it(
    'restarts dependents when no rebind callback exists',
    verifyRestartsDependentsWhenNoRebindCallbackExists
  )

  it(
    'keeps a diamond dependent blocked while another provider stays suspended',
    verifyKeepsADiamondDependentBlockedWhileAnotherProviderStaysSuspended
  )
})
