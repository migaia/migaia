import { describe, expect, it, vi } from 'vitest'

import {
  CapabilityGraphErrorCode,
  CapabilityGraphNodeState,
  createCapabilityGraph
} from '../../src/graph/index.ts'

import {
  id,
  instance,
  readyInstance,
  noRelease,
  failingStaticInstance,
  failingAuxiliaryDescriptor,
  startWithAuxiliaryDescriptors,
  failingTracedStaticInstance,
  tracedStaticInstance,
  readinessReentryInstance,
  disposalReentryInstance,
  deferred
} from './static-fixtures.ts'

/** Covers the contract: starts a whole level before awaiting it and preserves reverse release. */
async function startsAWholeLevelBeforeAwaitingItAndPreservesReverseRelease(): Promise<void> {
  /** Independent startup gates expose concurrency without a wall-clock assertion. */
  const first = deferred<ReturnType<typeof instance<string>>>()
  /** The later registration settles first to separate invocation order from completion order. */
  const second = deferred<ReturnType<typeof instance<string>>>()
  /** Invocation and physical release order remain separate observable contracts. */
  const started: string[] = []
  /** Root ownership must release by topology rather than by completion order. */
  const released: string[] = []
  /** Real Graph ownership coordinates both the level barrier and dependent provider reads. */
  const graph = createCapabilityGraph()
  for (const [name, gate] of [
    ['first', first],
    ['second', second]
  ] as const)
    graph.register({
      id: id(name),
      kind: 'test',
      dependencies: [],
      start: () => {
        started.push(name)
        return gate.promise
      }
    })
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('first'), required: true }],
    start: (context) => {
      started.push('consumer')
      expect(context.get(id('first'))).toBe('first')
      return tracedStaticInstance('consumer', released, 'consumer')
    }
  })
  /** Keep the exact initial readiness promise while selectively completing the starts. */
  const ready = graph.ready()
  try {
    expect([...started]).toEqual(['first', 'second'])
    second.resolve(
      instance('second', () => {
        released.push('second')
      })
    )
    await Promise.resolve()
    expect([...started]).toEqual(['first', 'second'])
    first.resolve(
      instance('first', () => {
        released.push('first')
      })
    )
    await ready
    expect([...started]).toEqual(['first', 'second', 'consumer'])
    await graph.dispose()
    expect(released).toEqual(['consumer', 'second', 'first'])
  } finally {
    first.resolve(instance('first'))
    second.resolve(instance('second'))
    await ready.catch(() => undefined)
    await graph.dispose()
  }
}

/** Covers the contract: rolls back prior nodes while retaining consumer primary failure. */
async function rollsBackPriorNodesWhileRetainingConsumerPrimaryFailure(): Promise<void> {
  const released = vi.fn()
  const primary = new Error('consumer failed')
  const graph = createCapabilityGraph()
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: () => instance(1, released)
  })
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('provider'), required: true }],
    start: () => {
      throw primary
    }
  })
  await expect(graph.ready()).rejects.toBe(primary)
  expect(released).toHaveBeenCalledOnce()
  expect(graph.nodeState(id('provider')).state).toBe(CapabilityGraphNodeState.rolledBack)
}

/** Covers the contract: reports rollback cleanup failure without replacing startup primary. */
async function reportsRollbackCleanupFailureWithoutReplacingStartupPrimary(): Promise<void> {
  const primary = new Error('startup primary')
  const cleanup = new Error('cleanup secondary')
  const reported: unknown[] = []
  const graph = createCapabilityGraph({ onError: (error) => reported.push(error) })
  graph.register({
    id: id('provider'),
    kind: 'test',
    dependencies: [],
    start: ({ own }) => {
      own({}, failingAuxiliaryDescriptor(cleanup))
      return instance(1)
    }
  })
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('provider'), required: true }],
    start: () => {
      throw primary
    }
  })
  await expect(graph.ready()).rejects.toBe(primary)
  expect(reported).toContain(cleanup)
}

/** Covers the contract: keeps unknown-node diagnostics stable after terminal. */
async function keepsUnknownNodeDiagnosticsStableAfterTerminal(): Promise<void> {
  const graph = createCapabilityGraph()
  await graph.dispose()
  expect(() => graph.nodeState(id('missing'))).toThrow(
    expect.objectContaining({ code: CapabilityGraphErrorCode.unknownNode })
  )
}

/** Covers the contract: continues all releases and preserves tagged aggregate failures. */
async function continuesAllReleasesAndPreservesTaggedAggregateFailures(): Promise<void> {
  const first = new Error('first release')
  const second = new Error('second release')
  const released: string[] = []
  const graph = createCapabilityGraph()
  graph.register({
    id: id('first'),
    kind: 'test',
    dependencies: [],
    start: () => failingTracedStaticInstance(1, { released, name: 'first', failure: first })
  })
  graph.register({
    id: id('second'),
    kind: 'test',
    dependencies: [],
    start: () => failingTracedStaticInstance(2, { released, name: 'second', failure: second })
  })
  await graph.ready()
  await expect(graph.dispose()).rejects.toBeInstanceOf(AggregateError)
  await expect(graph.dispose()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.disposeFailed
  })
  expect(released).toEqual(['second', 'first'])
}

/** Covers the contract: rejects synchronous release reentry with Graph-owned code. */
async function rejectsSynchronousReleaseReentryWithGraphOwnedCode(): Promise<void> {
  let graph!: ReturnType<typeof createCapabilityGraph>
  graph = createCapabilityGraph()
  graph.register({
    id: id('reentrant'),
    kind: 'test',
    dependencies: [],
    start: () => readinessReentryInstance(graph)
  })
  await graph.ready()
  await expect(graph.dispose()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.reentrantOperation
  })
}

/** Covers the contract: rejects auxiliary-primary identity collision before commit. */
async function rejectsAuxiliaryPrimaryIdentityCollisionBeforeCommit(): Promise<void> {
  const resource = {}
  const graph = createCapabilityGraph()
  graph.register({
    id: id('collision-admission'),
    kind: 'test',
    dependencies: [],
    start: ({ own }) => {
      own(resource, { force: noRelease })
      return instance(resource)
    }
  })
  await expect(graph.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.invalidNode
  })
}

/** Covers the contract: rejects auxiliary-primary identity collision and releases auxiliary once. */
async function rejectsAuxiliaryPrimaryIdentityCollisionAndReleasesAuxiliaryOnce(): Promise<void> {
  const released = vi.fn()
  const resource = {}
  const graph = createCapabilityGraph()
  graph.register({
    id: id('collision'),
    kind: 'test',
    dependencies: [],
    start: ({ own }) => {
      own(resource, { force: released })
      return instance(resource)
    }
  })
  await expect(graph.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.invalidNode
  })
  await graph.dispose()
  expect(released).toHaveBeenCalledOnce()
}

/** Covers the contract: exposes released diagnostics and converts release reentrancy. */
async function exposesReleasedDiagnosticsAndConvertsReleaseReentrancy(): Promise<void> {
  let graph!: ReturnType<typeof createCapabilityGraph>
  graph = createCapabilityGraph()
  graph.register({
    id: id('released'),
    kind: 'test',
    dependencies: [],
    start: readyInstance
  })
  await graph.ready()
  await graph.dispose()
  expect(graph.nodeState(id('released')).state).toBe(CapabilityGraphNodeState.released)

  const reentrant = createCapabilityGraph()
  reentrant.register({
    id: id('reentrant'),
    kind: 'test',
    dependencies: [],
    start: () => disposalReentryInstance(reentrant)
  })
  await reentrant.ready()
  await expect(reentrant.dispose()).rejects.toMatchObject({
    source: 'capability.graph',
    code: CapabilityGraphErrorCode.reentrantOperation
  })
}

/** Covers the contract: records primary release failure on the node diagnostic. */
async function recordsPrimaryReleaseFailureOnTheNodeDiagnostic(): Promise<void> {
  const releaseError = new Error('release failed')
  const graph = createCapabilityGraph()
  graph.register({
    id: id('broken'),
    kind: 'test',
    dependencies: [],
    start: () => failingStaticInstance(1, releaseError)
  })
  await graph.ready()
  await expect(graph.dispose()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.disposeFailed
  })
  expect(graph.nodeState(id('broken'))).toMatchObject({
    state: CapabilityGraphNodeState.failed,
    error: releaseError
  })
}

/** Covers the contract: exercises auxiliary descriptor adapters and async primary release branches. */
async function exercisesAuxiliaryDescriptorAdaptersAndAsyncPrimaryReleaseBranches(): Promise<void> {
  const events: string[] = []
  const graph = createCapabilityGraph()
  graph.register({
    id: id('aux'),
    kind: 'test',
    dependencies: [],
    start: (context) => startWithAuxiliaryDescriptors(context, events)
  })
  await graph.ready()
  await graph.dispose()
  expect(events).toContain('primary')
}

describe('capability graph-cleanup', () => {
  it(
    'starts a whole level before awaiting it and preserves reverse release',
    startsAWholeLevelBeforeAwaitingItAndPreservesReverseRelease
  )

  it(
    'rolls back prior nodes while retaining consumer primary failure',
    rollsBackPriorNodesWhileRetainingConsumerPrimaryFailure
  )

  it(
    'reports rollback cleanup failure without replacing startup primary',
    reportsRollbackCleanupFailureWithoutReplacingStartupPrimary
  )

  it(
    'keeps unknown-node diagnostics stable after terminal',
    keepsUnknownNodeDiagnosticsStableAfterTerminal
  )

  it(
    'continues all releases and preserves tagged aggregate failures',
    continuesAllReleasesAndPreservesTaggedAggregateFailures
  )

  it(
    'rejects synchronous release reentry with Graph-owned code',
    rejectsSynchronousReleaseReentryWithGraphOwnedCode
  )

  it(
    'rejects auxiliary-primary identity collision before commit',
    rejectsAuxiliaryPrimaryIdentityCollisionBeforeCommit
  )

  it(
    'rejects auxiliary-primary identity collision and releases auxiliary once',
    rejectsAuxiliaryPrimaryIdentityCollisionAndReleasesAuxiliaryOnce
  )

  it(
    'exposes released diagnostics and converts release reentrancy',
    exposesReleasedDiagnosticsAndConvertsReleaseReentrancy
  )

  it(
    'records primary release failure on the node diagnostic',
    recordsPrimaryReleaseFailureOnTheNodeDiagnostic
  )

  it(
    'exercises auxiliary descriptor adapters and async primary release branches',
    exercisesAuxiliaryDescriptorAdaptersAndAsyncPrimaryReleaseBranches
  )
})
