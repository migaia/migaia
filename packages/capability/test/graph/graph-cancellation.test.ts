import { describe, expect, it, vi } from 'vitest'

import {
  CapabilityGraphErrorCode,
  CapabilityGraphState,
  createCapabilityGraph
} from '../../src/graph/index.ts'

import { id, instance, deferred } from './static-fixtures.ts'

/**
 * Covers the contract: disposes while two same-level starts are pending and releases both late
 * results.
 */
async function disposesWhileTwoSameLevelStartsArePendingAndReleasesBothLateResults(): Promise<void> {
  /** Starts and releases have separate gates so disposal never waits for uncooperative work. */
  const starts = [
    deferred<ReturnType<typeof instance<number>>>(),
    deferred<ReturnType<typeof instance<number>>>()
  ]
  /** Physical-release completion provides a bounded observable for each late result. */
  const releases = [deferred<void>(), deferred<void>()]
  /** Both starts must be invoked before disposal begins. */
  const invoked: number[] = []
  /** Every late physical release must occur once, in resolution order. */
  const released: number[] = []
  /** Public disposal must remain independent of unresolved startup work. */
  const graph = createCapabilityGraph()
  for (const [position, start] of starts.entries())
    graph.register({
      id: id(String(position)),
      kind: 'test',
      dependencies: [],
      start: () => {
        invoked.push(position)
        return start.promise
      }
    })
  /** Disposal rejects readiness immediately while the original starts remain pending. */
  const ready = graph.ready().catch((error: unknown) => error)
  try {
    expect([...invoked]).toEqual([0, 1])
    /** Repeated disposal must preserve its existing completion identity. */
    const disposal = graph.dispose()
    expect(graph.dispose()).toBe(disposal)
    await disposal
    expect(await ready).toMatchObject({ code: CapabilityGraphErrorCode.admissionClosed })
    for (const position of [1, 0]) {
      starts[position]!.resolve(
        instance(position, () => {
          released.push(position)
          releases[position]!.resolve()
        })
      )
      await releases[position]!.promise
    }
    expect(released).toEqual([1, 0])
    expect(graph.state).toBe(CapabilityGraphState.terminal)
    expect(graph.nodeState(id('0')).value).toBeUndefined()
    expect(graph.nodeState(id('1')).value).toBeUndefined()
  } finally {
    for (const start of starts) start.resolve(instance(0))
    await ready
    await graph.dispose()
  }
}

/** Covers the contract: releases a late start result after dispose without an unhandled rejection. */
async function releasesALateStartResultAfterDisposeWithoutAnUnhandledRejection(): Promise<void> {
  let resolve!: (value: ReturnType<typeof instance>) => void
  const lateRelease = vi.fn()
  const pending = new Promise<ReturnType<typeof instance>>((done) => {
    resolve = done
  })
  const graph = createCapabilityGraph()
  graph.register({ id: id('late'), kind: 'test', dependencies: [], start: () => pending })
  const ready = graph.ready()
  await graph.dispose()
  resolve(instance('late', lateRelease))
  await expect(ready).rejects.toMatchObject({ code: CapabilityGraphErrorCode.admissionClosed })
  await Promise.resolve()
  expect(lateRelease).toHaveBeenCalledOnce()
}

/** Covers the contract: keeps every node signal alive until graph disposal. */
async function keepsEveryNodeSignalAliveUntilGraphDisposal(): Promise<void> {
  const signals: AbortSignal[] = []
  const graph = createCapabilityGraph()
  graph.register({
    id: id('first'),
    kind: 'test',
    dependencies: [],
    start: ({ signal }) => {
      signals.push(signal as unknown as AbortSignal)
      return instance('first')
    }
  })
  graph.register({
    id: id('second'),
    kind: 'test',
    dependencies: [],
    start: ({ signal }) => {
      signals.push(signal as unknown as AbortSignal)
      return instance('second')
    }
  })
  await graph.ready()
  expect(signals.map((signal) => signal.aborted)).toEqual([false, false])
  await graph.dispose()
  expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
}

/** Covers the contract: keeps terminal state after a late resolve. */
async function keepsTerminalStateAfterALateResolve(): Promise<void> {
  const pending = deferred<ReturnType<typeof instance>>()
  const lateRelease = vi.fn()
  const reported: unknown[] = []
  const graph = createCapabilityGraph({ onError: (error) => reported.push(error) })
  graph.register({
    id: id('late'),
    kind: 'test',
    dependencies: [],
    start: () => pending.promise
  })
  const ready = graph.ready()
  await graph.dispose()
  const primary = graph.error
  pending.resolve(instance('late', lateRelease))
  await expect(ready).rejects.toBe(primary)
  await Promise.resolve()
  expect(graph.state).toBe('terminal')
  expect(graph.error).toBe(primary)
  expect(lateRelease).toHaveBeenCalledOnce()
  expect(reported).toEqual([])
}

/** Covers the contract: keeps the admission-closed primary when a late start rejects. */
async function keepsTheAdmissionClosedPrimaryWhenALateStartRejects(): Promise<void> {
  const pending = deferred<ReturnType<typeof instance>>()
  const lateError = new Error('late rejection')
  const reported: unknown[] = []
  const graph = createCapabilityGraph({ onError: (error) => reported.push(error) })
  graph.register({
    id: id('late-reject'),
    kind: 'test',
    dependencies: [],
    start: () => pending.promise
  })
  const ready = graph.ready()
  const dispose = graph.dispose()
  const primary = graph.error
  pending.reject(lateError)
  await expect(ready).rejects.toBe(primary)
  await dispose
  expect(graph.error).toBe(primary)
  expect(reported).toContain(lateError)
}

describe('capability graph-cancellation', () => {
  it(
    'disposes while two same-level starts are pending and releases both late results',
    disposesWhileTwoSameLevelStartsArePendingAndReleasesBothLateResults
  )

  it(
    'releases a late start result after dispose without an unhandled rejection',
    releasesALateStartResultAfterDisposeWithoutAnUnhandledRejection
  )

  it(
    'keeps every node signal alive until graph disposal',
    keepsEveryNodeSignalAliveUntilGraphDisposal
  )

  it('keeps terminal state after a late resolve', keepsTerminalStateAfterALateResolve)

  it(
    'keeps the admission-closed primary when a late start rejects',
    keepsTheAdmissionClosedPrimaryWhenALateStartRejects
  )
})
