import {
  TopologyAdapterFailure,
  throwUnknownProvider,
  throwGraphCycle,
  RejectedBoundaryReporter,
  reportingGraphInstance,
  emptyGraphBatch,
  emptyGraphInstance
} from './fixtures/graph-boundary.js'
import { describe, expect, it, vi } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { createCapabilityHost, snapshotGraphReadiness } from '../src/index.js'
import { createCapabilityGraph, type IGraphNodeId } from '../src/graph/index.js'
import { createDynamicCapabilityGraph } from '../src/graph/dynamic.js'
import { createTopologyIndex, buildCapabilityTopology } from '../src/graph/topology.js'
import { resolveInstallSet } from '../src/graph/dependency.js'

describe('audited capability boundary contracts', () => {
  it(
    'preserves the standard readonly Map and Set forEach receiver',
    verifyPreservesTheStandardReadonlyMapAndSetForEachReceiver
  )

  it.each(['static', 'incremental'] as const)(
    'retains %s topology getter failure when the adapter chooses its own error',
    verifyRetainsSTopologyGetterFailureWhenTheAdapterChoosesItsOwnError
  )

  it(
    'annotates a native readiness getter error without replacing it',
    verifyAnnotatesANativeReadinessGetterErrorWithoutReplacingIt
  )

  it.each(['host', 'static', 'dynamic'] as const)(
    'reports a %s reporter failure without changing cleanup',
    verifyReportsASReporterFailureWithoutChangingCleanup
  )

  it(
    'reads registration ordinals from the canonical topology owner after removal',
    verifyReadsRegistrationOrdinalsFromTheCanonicalTopologyOwnerAfterRemoval
  )
})

/** Executes the existing case: preserves the standard readonly Map and Set forEach receiver. */
function verifyPreservesTheStandardReadonlyMapAndSetForEachReceiver(): void {
  /** Pure topology retains collection semantics while denying mutation. */
  const index = createTopologyIndex({
    onCycle() {
      throw new Error('cycle')
    },
    onInvalid() {
      throw new Error('invalid')
    }
  })
  index.add({ id: 'a', dependencies: [] })
  /** Explicit thisArg is part of both native collection protocols. */
  const receiver = {}
  /** Both callbacks must observe the same supplied receiver. */
  const seen: unknown[] = []
  index.snapshot().level.forEach(function (this: unknown) {
    seen.push(this)
  }, receiver)
  resolveInstallSet(index, ['a'], () => false).forEach(function (this: unknown) {
    seen.push(this)
  }, receiver)
  expect(seen).toEqual([receiver, receiver])
}

/**
 * Executes the existing case: retains %s topology getter failure when the adapter chooses its own
 * error.
 */
function verifyRetainsSTopologyGetterFailureWhenTheAdapterChoosesItsOwnError(
  kind: 'static' | 'incremental'
): void {
  /** Captured input failure must remain reachable even when the adapter throws another error. */
  const original = new Error('node getter')
  /** A mutable native adapter error should retain its type and identity. */
  const adapterFailure = new TypeError('invalid topology')
  /** Optional failure metadata lets existing domain adapters choose their own cause policy. */
  let supplied: unknown
  /** Legacy adapter behavior still receives traceability through secondary errors. */
  const adapter = new TopologyAdapterFailure(adapterFailure, (cause) => {
    supplied = cause
  })
  /** Both public topology admission paths read the same hostile node shape. */
  const node = {
    get id(): string {
      throw original
    },
    ordinal: 0,
    dependencies: []
  }
  expect(() =>
    kind === 'static'
      ? buildCapabilityTopology([node], throwUnknownProvider, throwGraphCycle, adapter.invalid)
      : createTopologyIndex({
          onCycle: throwGraphCycle,
          onInvalid: adapter.invalid
        }).add(node)
  ).toThrow(adapterFailure)
  expect(supplied).toBe(original)
  expect(walkErrorCauses(adapterFailure).includes(original)).toBe(true)
}

/** Executes the existing case: annotates a native readiness getter error without replacing it. */
function verifyAnnotatesANativeReadinessGetterErrorWithoutReplacingIt(): void {
  /** Readiness admission owns failures while taking its fixed one-time snapshot. */
  const original = new RangeError('readiness getter')
  /** Defining the getter does not execute it; the original expect callback still triggers its read. */
  const source = {
    get state(): never {
      throw original
    },
    error: undefined
  }
  expect(() => snapshotGraphReadiness(source)).toThrow(original)
  expect(original).toMatchObject({ source: 'capability', code: 'INVALID_OPTION' })
}

/** Executes the existing case: reports a %s reporter failure without changing cleanup. */
async function verifyReportsASReporterFailureWithoutChangingCleanup(
  kind: 'host' | 'static' | 'dynamic'
): Promise<void> {
  /** Terminal reports remain observable outside the owning business Promise. */
  const callbacks: (() => void)[] = []
  /** Capture utils' shared terminal channel rather than throwing into the test host. */
  const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    callbacks.push(callback)
  })
  /** A separate diagnostic failure proves the reporter's own error survives. */
  const failure = new Error('reporter failed')
  /** Existing user reporter may be implemented asynchronously. */
  const reporter = new RejectedBoundaryReporter(failure)
  try {
    if (kind === 'host') {
      /** Activation failure remains queryable after its diagnostic sink rejects. */
      const host = createCapabilityHost({}, { flags: { a: true }, onError: reporter.report })
      host.register({
        name: 'a',
        activate() {
          throw new Error('activation failed')
        }
      })
      expect((await host.enable('a')).status).toBe('failed')
      await host.dispose()
    } else if (kind === 'static') {
      /** A normal release can emit a diagnostic through its provided context. */
      const graph = createCapabilityGraph({ onError: reporter.report })
      graph.register({
        id: 'a' as IGraphNodeId,
        kind: 'service',
        dependencies: [],
        start: reportingGraphInstance
      })
      await graph.ready()
      await graph.dispose()
      expect(graph.state).toBe('terminal')
    } else {
      /** Physical release failure leaves a binding notification failure as a secondary report. */
      const graph = createDynamicCapabilityGraph({
        startBatch: emptyGraphBatch,
        releaseBatch: () => undefined,
        releaseBinding: () => {
          throw new Error('binding release failed')
        },
        report: reporter.report
      })
      await graph.register(
        {
          id: 'a' as IGraphNodeId,
          kind: 'service',
          dependencies: [],
          start: emptyGraphInstance
        },
        {}
      )
      await graph.dispose()
      expect(graph.state).toBe('terminal')
    }
    for (let turn = 0; turn < 12; turn++) await Promise.resolve()
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0]).toThrow(failure)
  } finally {
    queue.mockRestore()
  }
}

/**
 * Executes the existing case: reads registration ordinals from the canonical topology owner after
 * removal.
 */
async function verifyReadsRegistrationOrdinalsFromTheCanonicalTopologyOwnerAfterRemoval(): Promise<void> {
  /** Batch composition is unrelated to the diagnostic ordering fact. */
  const graph = createDynamicCapabilityGraph({
    startBatch: emptyGraphBatch,
    releaseBatch() {}
  })
  for (const id of ['a', 'b', 'c'])
    await graph.register({
      id: id as IGraphNodeId,
      kind: 'service',
      dependencies: [],
      start: emptyGraphInstance
    })
  await graph.remove('a' as IGraphNodeId)
  await graph.register({
    id: 'd' as IGraphNodeId,
    kind: 'service',
    dependencies: [],
    start: emptyGraphInstance
  })
  expect(['b', 'c', 'd'].map((id) => graph.nodeState(id as IGraphNodeId).ordinal)).toEqual([
    1, 2, 3
  ])
  await graph.dispose()
}
