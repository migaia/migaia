import { describe, expect, it, vi } from 'vitest'

import {
  CapabilityGraphErrorCode,
  CapabilityGraphNodeState,
  createCapabilityGraph
} from '../../src/graph/index.ts'

import { createDynamicCapabilityGraph } from '../../src/graph/dynamic.ts'
import { createTestBatchOwner } from '../fixtures/dynamic-batch-owner.ts'
import { id, instance, readyInstance } from './static-fixtures.ts'

/** Covers the contract: contains asynchronous diagnostic rejection without changing removal. */
async function containsAsynchronousDiagnosticRejectionWithoutChangingRemoval(): Promise<void> {
  /** Terminal reporter rejection stays observable outside removal's business Promise. */
  const callbacks: (() => void)[] = []
  /** Inspect the existing utils host channel without crashing the test process. */
  const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    callbacks.push(callback)
  })
  /** Binding cleanup is the original diagnostic; reporter failure must remain observer-only. */
  const cleanupFailure = new Error('binding cleanup')
  /** A real rejected Promise must be handled by the diagnostic boundary, not by the fixture. */
  const reporterFailure = new Error('reporter rejection')
  /** Exact raw errors reaching the final sink are independently observable. */
  const reports: unknown[] = []
  /** A genuine batch owner drives the same removal path used by production consumers. */
  const graph = createDynamicCapabilityGraph<object>({
    ...createTestBatchOwner<object>(),
    releaseBinding: () => {
      throw cleanupFailure
    },
    report: (error) => {
      reports.push(error)
      return Promise.reject(reporterFailure)
    }
  })
  await graph.register(
    { id: id('reported'), kind: 'test', dependencies: [], start: readyInstance },
    {}
  )
  await graph.remove(id('reported'))
  // Cross the host rejection-observation turn; Vitest fails the case for an unhandled rejection.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(reports).toEqual([cleanupFailure])
  expect(graph.nodes).toEqual([])
  await graph.dispose()
  expect(callbacks).toHaveLength(1)
  expect(callbacks[0]).toThrow(reporterFailure)
  queue.mockRestore()
}

/** Covers the contract: rejects an unknown provider before any start callback. */
async function rejectsAnUnknownProviderBeforeAnyStartCallback(): Promise<void> {
  const graph = createCapabilityGraph()
  const start = vi.fn(() => instance(1))
  graph.register({
    id: id('consumer'),
    kind: 'test',
    dependencies: [{ provider: id('missing'), required: true }],
    start
  })
  await expect(graph.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.unknownProvider
  })
  expect(start).not.toHaveBeenCalled()
}

/** Covers the contract: blocks required dependents when their provider fails. */
async function blocksRequiredDependentsWhenTheirProviderFails(): Promise<void> {
  const graph = createCapabilityGraph()
  graph.register({
    id: id('failed'),
    kind: 'test',
    dependencies: [],
    start: () => {
      throw new Error('provider failed')
    }
  })
  graph.register({
    id: id('dependent'),
    kind: 'test',
    dependencies: [{ provider: id('failed'), required: true }],
    start: readyInstance
  })
  await expect(graph.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.startFailed
  })
  expect(graph.nodeState(id('failed')).state).toBe(CapabilityGraphNodeState.failed)
  expect(graph.nodeState(id('dependent')).state).toBe(CapabilityGraphNodeState.blocked)
}

/** Covers the contract: preserves failed graph state without implicit retry. */
async function preservesFailedGraphStateWithoutImplicitRetry(): Promise<void> {
  const start = vi.fn(() => {
    throw new Error('failed')
  })
  const graph = createCapabilityGraph()
  graph.register({ id: id('failed'), kind: 'test', dependencies: [], start })
  const first = graph.ready()
  const second = graph.ready()
  await expect(first).rejects.toMatchObject({ code: CapabilityGraphErrorCode.startFailed })
  await expect(second).rejects.toBe(graph.error)
  expect(start).toHaveBeenCalledOnce()
  expect(graph.state).toBe('failed')
}

/** Covers the contract: reports a closed stable path for mixed resolved and residual edges. */
async function reportsAClosedStablePathForMixedResolvedAndResidualEdges(): Promise<void> {
  const graph = createCapabilityGraph()
  graph.register({ id: id('root'), kind: 'test', dependencies: [], start: () => instance(0) })
  graph.register({
    id: id('a'),
    kind: 'test',
    dependencies: [
      { provider: id('root'), required: true },
      { provider: id('b'), required: true }
    ],
    start: readyInstance
  })
  graph.register({
    id: id('b'),
    kind: 'test',
    dependencies: [{ provider: id('a'), required: true }],
    start: () => instance(2)
  })
  await expect(graph.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.dependencyCycle
  })
  const path = (graph.error as { detail: { path: string[] } }).detail.path
  expect(path.length).toBeGreaterThan(1)
  expect(path[0]).toBe(path[path.length - 1])
}

describe('capability graph-startup', () => {
  it(
    'contains asynchronous diagnostic rejection without changing removal',
    containsAsynchronousDiagnosticRejectionWithoutChangingRemoval
  )

  it(
    'rejects an unknown provider before any start callback',
    rejectsAnUnknownProviderBeforeAnyStartCallback
  )

  it(
    'blocks required dependents when their provider fails',
    blocksRequiredDependentsWhenTheirProviderFails
  )

  it(
    'preserves failed graph state without implicit retry',
    preservesFailedGraphStateWithoutImplicitRetry
  )

  it(
    'reports a closed stable path for mixed resolved and residual edges',
    reportsAClosedStablePathForMixedResolvedAndResidualEdges
  )
})
