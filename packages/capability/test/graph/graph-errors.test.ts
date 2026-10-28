import { describe, expect, it } from 'vitest'

import {
  CapabilityGraphErrorCode,
  CapabilityGraphNodeState,
  createCapabilityGraph
} from '../../src/graph/index.js'

import { createDynamicCapabilityGraph } from '../../src/graph/dynamic.js'
import { createTestBatchOwner } from '../fixtures/dynamic-batch-owner.js'
import {
  id,
  instance,
  readyInstance,
  freshReleaseFailureInstance,
  assertGraphErrorCode,
  deferred
} from './static-fixtures.js'

/** Covers the contract: wraps non-Error startup throws with reachable cause. */
async function wrapsNonErrorStartupThrowsWithReachableCause(): Promise<void> {
  const thrown = { reason: 'foreign' }
  const graph = createCapabilityGraph()
  graph.register({
    id: id('foreign'),
    kind: 'test',
    dependencies: [],
    start: () => {
      throw thrown
    }
  })
  await expect(graph.ready()).rejects.toMatchObject({
    source: 'capability.graph',
    code: CapabilityGraphErrorCode.startFailed,
    cause: thrown
  })
}

/** Covers the contract: assimilates a hostile start thenable once and tags getter failure. */
async function assimilatesAHostileStartThenableOnceAndTagsGetterFailure(): Promise<void> {
  const thenError = new Error('then getter failed')
  const graph = createCapabilityGraph()
  const thenKey = ['t', 'h', 'e', 'n'].join('')
  const thenable = Object.defineProperty({}, thenKey, {
    get() {
      throw thenError
    }
  })
  graph.register({
    id: id('thenable'),
    kind: 'test',
    dependencies: [],
    start: () => thenable as never
  })
  await expect(graph.ready()).rejects.toMatchObject({
    code: CapabilityGraphErrorCode.startFailed
  })
  expect(thenError).toMatchObject({ source: 'capability.graph' })
}

/** Covers the contract: keeps start errors traceable and records failed node diagnostics. */
async function keepsStartErrorsTraceableAndRecordsFailedNodeDiagnostics(): Promise<void> {
  const startError = new Error('boom')
  const graph = createCapabilityGraph()
  graph.register({
    id: id('bad'),
    kind: 'test',
    dependencies: [],
    start: () => {
      throw startError
    }
  })
  await expect(graph.ready()).rejects.toBe(startError)
  expect(graph.error).toBe(startError)
  expect(graph.nodeState(id('bad'))).toMatchObject({
    state: CapabilityGraphNodeState.failed,
    error: startError
  })
}

/**
 * Verifies that verifies every Graph error code as a native traceable boundary error. This is one
 * indivisible public error-code matrix: every branch contributes to the final completeness
 * assertion over the same seenCodes set; keeping it together preserves that oracle.
 */
async function verifiesEveryGraphErrorCodeAsANativeTraceableBoundaryError(): Promise<void> {
  const seenCodes = new Set<string>()

  const disposed = createCapabilityGraph()
  await disposed.ready()
  await disposed.dispose()
  try {
    disposed.register({ id: id('x'), kind: 'test', dependencies: [], start: readyInstance })
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.graphDisposed, seenCodes)
  }
  const frozen = createCapabilityGraph()
  await frozen.ready()
  try {
    frozen.register({ id: id('x'), kind: 'test', dependencies: [], start: readyInstance })
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.graphFrozen, seenCodes)
  }
  const invalid = createCapabilityGraph()
  try {
    invalid.register({
      id: id('x'),
      kind: 'test',
      dependencies: [{} as never],
      start: readyInstance
    })
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.invalidNode, seenCodes)
  }
  try {
    invalid.register({ id: id('x'), kind: 'test', dependencies: [], start: readyInstance })
    invalid.register({ id: id('x'), kind: 'test', dependencies: [], start: readyInstance })
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.duplicateNode, seenCodes)
  }
  const unknown = createCapabilityGraph()
  unknown.register({
    id: id('x'),
    kind: 'test',
    dependencies: [{ provider: id('missing'), required: true }],
    start: readyInstance
  })
  try {
    await unknown.ready()
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.unknownProvider, seenCodes)
  }
  const duplicateEdge = createCapabilityGraph()
  try {
    duplicateEdge.register({
      id: id('x'),
      kind: 'test',
      dependencies: [
        { provider: id('p'), required: true },
        { provider: id('p'), required: true }
      ],
      start: readyInstance
    })
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.duplicateEdge, seenCodes)
  }
  const cycle = createCapabilityGraph()
  cycle.register({
    id: id('x'),
    kind: 'test',
    dependencies: [{ provider: id('x'), required: true }],
    start: readyInstance
  })
  try {
    await cycle.ready()
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.dependencyCycle, seenCodes)
  }
  const unavailable = createCapabilityGraph()
  unavailable.register({ id: id('x'), kind: 'test', dependencies: [], start: readyInstance })
  try {
    unavailable.get(id('x'), id('x'))
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.providerUnavailable, seenCodes)
  }
  const startFailed = createCapabilityGraph()
  startFailed.register({
    id: id('x'),
    kind: 'test',
    dependencies: [],
    start: () => {
      throw new Error('start')
    }
  })
  try {
    await startFailed.ready()
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.startFailed, seenCodes)
  }
  const releaseFailed = createCapabilityGraph()
  releaseFailed.register({
    id: id('x'),
    kind: 'test',
    dependencies: [],
    start: freshReleaseFailureInstance
  })
  await releaseFailed.ready()
  try {
    await releaseFailed.dispose()
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.disposeFailed, seenCodes)
  }
  try {
    releaseFailed.get(id('x'), id('x'))
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.graphDisposed, seenCodes)
  }
  const admissionClosed = createCapabilityGraph()
  const pending = deferred<ReturnType<typeof instance>>()
  admissionClosed.register({
    id: id('pending'),
    kind: 'test',
    dependencies: [],
    start: () => pending.promise
  })
  const pendingReady = admissionClosed.ready()
  try {
    admissionClosed.get(id('pending'), id('pending'))
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.admissionClosed, seenCodes)
  }
  pending.resolve(instance(1))
  await pendingReady
  await admissionClosed.dispose()
  const unknownNode = createCapabilityGraph()
  try {
    unknownNode.nodeState(id('missing'))
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.unknownNode, seenCodes)
  }
  let reentrant!: ReturnType<typeof createCapabilityGraph>
  reentrant = createCapabilityGraph()
  reentrant.register({
    id: id('x'),
    kind: 'test',
    dependencies: [],
    start: () => {
      reentrant.ready()
      return instance(1)
    }
  })
  try {
    await reentrant.ready()
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.reentrantOperation, seenCodes)
  }
  try {
    createCapabilityGraph({
      get onError(): undefined {
        throw new Error('option')
      }
    })
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.invalidOption, seenCodes)
  }
  try {
    createCapabilityGraph({ onError: 1 as never })
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.invalidOption, seenCodes)
  }
  const dependentPolicy = createDynamicCapabilityGraph(createTestBatchOwner())
  await dependentPolicy.register({
    id: id('policy-provider'),
    kind: 'test',
    dependencies: [],
    start: readyInstance
  })
  await dependentPolicy.register({
    id: id('policy-consumer'),
    kind: 'test',
    dependencies: [{ provider: id('policy-provider'), required: true }],
    start: () => instance(2)
  })
  try {
    await dependentPolicy.remove(id('policy-provider'), { policy: 'reject' })
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.nodeHasDependents, seenCodes)
  }
  try {
    await dependentPolicy.resume(id('policy-provider'))
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.nodeNotSuspended, seenCodes)
  }
  await dependentPolicy.dispose()
  try {
    createDynamicCapabilityGraph({} as never)
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.invalidOption, seenCodes)
  }
  const stuck = deferred<ReturnType<typeof instance>>()
  const admission = createDynamicCapabilityGraph({
    ...createTestBatchOwner(),
    mutationAdmissionMs: 5
  })
  const stuckRegister = admission.register({
    id: id('stuck'),
    kind: 'test',
    dependencies: [],
    start: () => stuck.promise
  })
  try {
    await admission.register({
      id: id('queued'),
      kind: 'test',
      dependencies: [],
      start: readyInstance
    })
  } catch (error) {
    assertGraphErrorCode(error, CapabilityGraphErrorCode.mutationAdmissionTimeout, seenCodes)
  }
  stuck.resolve(instance(1))
  await stuckRegister
  await admission.dispose()
  // Both collections are bounded by the 17 declared keys of CapabilityGraphErrorCode.
  expect([...seenCodes].sort()).toEqual(Object.values(CapabilityGraphErrorCode).sort())
}

describe('capability graph-errors', () => {
  it(
    'wraps non-Error startup throws with reachable cause',
    wrapsNonErrorStartupThrowsWithReachableCause
  )

  it(
    'assimilates a hostile start thenable once and tags getter failure',
    assimilatesAHostileStartThenableOnceAndTagsGetterFailure
  )

  it(
    'keeps start errors traceable and records failed node diagnostics',
    keepsStartErrorsTraceableAndRecordsFailedNodeDiagnostics
  )

  it(
    'verifies every Graph error code as a native traceable boundary error',
    verifiesEveryGraphErrorCodeAsANativeTraceableBoundaryError
  )
})
