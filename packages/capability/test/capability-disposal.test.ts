import { RecordedCapabilityRelease, AsyncCapabilityRelease } from './fixtures/host-cleanup.ts'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilityHost, CapabilityErrorCode, type ICapabilityHandle } from '../src/index.ts'
import { handleOf, deferred, enabledHost } from './fixtures/capability-host.ts'

/** Existing host cases grouped by one lifecycle concern; assertions remain unchanged. */
describe('能力闸门：终态排空与释放顺序', () => {
  it(
    'rejects delayed disposer-origin dispose and reports once',
    verifyRejectsDelayedDisposerOriginDisposeAndReportsOnce
  )

  it(
    'rejects external in-progress dispose and reuses completed canonical Promise',
    verifyRejectsExternalInProgressDisposeAndReusesCompletedCanonicalPromise
  )

  it(
    'preserves the existing report-and-resolve cleanup rejection semantics',
    verifyPreservesTheExistingReportAndResolveCleanupRejectionSemantics
  )

  it(
    'isolates dispose cleanup failures and converges every entry to off',
    verifyIsolatesDisposeCleanupFailuresAndConvergesEveryEntryToOff
  )

  it(
    'structured enable result and async disposal await cleanup',
    verifyStructuredEnableResultAndAsyncDisposalAwaitCleanup
  )

  it(
    'dispose() waits for an activation still in flight, not just already-tracked releases',
    verifyDisposeWaitsForAnActivationStillInFlightNotJustAlreadyTrackedReleases
  )

  it(
    'publishes activation before synchronous activate disposal and waits for late cleanup',
    verifyPublishesActivationBeforeSynchronousActivateDisposalAndWaitsForLateCleanup
  )

  it(
    "disable() waits for that entry's activation still in flight, not just already-tracked releases",
    verifyDisableWaitsForThatEntrySActivationStillInFlightNotJustAlreadyTrackedReleases
  )

  it(
    'discards an in-flight activation that the host outlived',
    verifyDiscardsAnInFlightActivationThatTheHostOutlived
  )

  it('disposes in reverse activation order', verifyDisposesInReverseActivationOrder)
})

/** Executes the existing case: rejects delayed disposer-origin dispose and reports once. */
async function verifyRejectsDelayedDisposerOriginDisposeAndReportsOnce(): Promise<void> {
  let host!: ReturnType<typeof createCapabilityHost<undefined>>
  let selfError: unknown
  const reported: unknown[] = []
  const disposer = vi.fn(async () => {
    try {
      host.dispose()
    } catch (error) {
      selfError = error
    }
    await Promise.resolve()
    await host.dispose()
  })
  host = createCapabilityHost(undefined, {
    flags: { worker: true },
    onError: (_name, error) => reported.push(error)
  })
  host.register({
    name: 'worker',
    activate: () => ({ dispose: disposer })
  })
  await host.enable('worker')

  const first = host.dispose()
  expect(host.disposed).toBe(true)
  expect(selfError).toEqual(
    expect.objectContaining({
      source: 'capability',
      code: CapabilityErrorCode.hostTransitioning,
      message: 'capability host cannot mutate during a lifecycle transition'
    })
  )
  expect(disposer).toHaveBeenCalledOnce()

  await first
  expect(reported).toEqual([
    expect.objectContaining({
      source: 'capability',
      code: CapabilityErrorCode.hostTransitioning
    })
  ])
  expect(host.state('worker')).toBe('off')
  expect(host.handle('worker')).toBeUndefined()
  expect(host.dispose()).toBe(first)
  expect(disposer).toHaveBeenCalledOnce()
}

/**
 * Executes the existing case: rejects external in-progress dispose and reuses completed canonical
 * Promise.
 */
async function verifyRejectsExternalInProgressDisposeAndReusesCompletedCanonicalPromise(): Promise<void> {
  const cleanup = deferred<void>()
  const disposer = vi.fn(() => cleanup.promise)
  const host = enabledHost(undefined, 'worker')
  host.register({ name: 'worker', activate: () => ({ dispose: disposer }) })
  await host.enable('worker')

  const first = host.dispose()
  const concurrent = host.dispose()
  expect(concurrent).not.toBe(first)
  await expect(concurrent).rejects.toEqual(
    expect.objectContaining({
      source: 'capability',
      code: CapabilityErrorCode.hostTransitioning
    })
  )

  cleanup.resolve()
  await expect(first).resolves.toBeUndefined()
  expect(host.dispose()).toBe(first)
}

/**
 * Executes the existing case: preserves the existing report-and-resolve cleanup rejection
 * semantics.
 */
async function verifyPreservesTheExistingReportAndResolveCleanupRejectionSemantics(): Promise<void> {
  const cleanupError = new Error('cleanup rejected')
  const onError = vi.fn()
  const host = createCapabilityHost<undefined>(undefined, {
    flags: { worker: true },
    onError
  })
  const disposer = vi.fn(async () => {
    throw cleanupError
  })
  host.register({ name: 'worker', activate: () => ({ dispose: disposer }) })
  await host.enable('worker')

  const first = host.dispose()
  const second = host.dispose()
  await expect(second).rejects.toEqual(
    expect.objectContaining({
      source: 'capability',
      code: CapabilityErrorCode.hostTransitioning
    })
  )
  await expect(first).resolves.toBeUndefined()
  expect(disposer).toHaveBeenCalledOnce()
  expect(onError).toHaveBeenCalledTimes(1)
  expect(onError).toHaveBeenCalledWith('worker', cleanupError)
  expect(host.dispose()).toBe(first)
}

/** Executes the existing case: isolates dispose cleanup failures and converges every entry to off. */
async function verifyIsolatesDisposeCleanupFailuresAndConvergesEveryEntryToOff(): Promise<void> {
  const releaseOrder: string[] = []
  const firstCleanupError = new Error('third cleanup failed')
  const secondCleanupError = new Error('second cleanup failed')
  const onError = vi.fn()
  const host = createCapabilityHost(undefined, {
    flags: { first: true, second: true, third: true },
    onError
  })
  /** Cleanup fixture keeps release order and failure timing under the host's disposer call. */
  const releaseFirst = new RecordedCapabilityRelease(releaseOrder, 'first')
  host.register({
    name: 'first',
    activate: () => ({ dispose: releaseFirst.dispose })
  })
  /** Cleanup fixture keeps release order and failure timing under the host's disposer call. */
  const releaseSecond = new RecordedCapabilityRelease(releaseOrder, 'second', secondCleanupError)
  host.register({
    name: 'second',
    activate: () => ({ dispose: releaseSecond.dispose })
  })
  /** Cleanup fixture keeps release order and failure timing under the host's disposer call. */
  const releaseThird = new RecordedCapabilityRelease(releaseOrder, 'third', firstCleanupError)
  host.register({
    name: 'third',
    activate: () => ({ dispose: releaseThird.dispose })
  })

  await host.enable('first')
  await host.enable('second')
  await host.enable('third')

  const firstDispose = host.dispose()
  expect(host.disposed).toBe(true)
  await expect(host.dispose()).rejects.toEqual(
    expect.objectContaining({
      source: 'capability',
      code: CapabilityErrorCode.hostTransitioning
    })
  )
  await expect(firstDispose).resolves.toBeUndefined()

  expect(releaseOrder).toEqual(['third', 'second', 'first'])
  expect(onError.mock.calls).toEqual([
    ['third', firstCleanupError],
    ['second', secondCleanupError]
  ])
  expect(host.error('third')).toBe(firstCleanupError)
  expect(host.error('second')).toBe(secondCleanupError)
  for (const name of ['first', 'second', 'third']) {
    expect(host.state(name)).toBe('off')
    expect(host.handle(name)).toBeUndefined()
  }
  expect(host.dispose()).toBe(firstDispose)
}

/** Executes the existing case: structured enable result and async disposal await cleanup. */
async function verifyStructuredEnableResultAndAsyncDisposalAwaitCleanup(): Promise<void> {
  let released = false
  const host = createCapabilityHost<unknown>({}, { flags: { worker: true } })
  /** Cleanup becomes visible only after the original asynchronous release continuation. */
  const cleanup = new AsyncCapabilityRelease(() => {
    released = true
  })
  host.register({
    name: 'worker',
    activate: () => ({ dispose: cleanup.dispose })
  })
  expect(await host.enable('worker')).toEqual({
    status: 'enabled'
  })
  await host.dispose()
  expect(released).toBe(true)
}

/**
 * Executes the existing case: dispose() waits for an activation still in flight, not just
 * already-tracked releases.
 */
async function verifyDisposeWaitsForAnActivationStillInFlightNotJustAlreadyTrackedReleases(): Promise<void> {
  // The bug this guards: dispose() used to snapshot only
  // `pendingReleases` — a still-running activate() has no handle yet, so
  // it has nothing in that snapshot to await. It would resolve, then the
  // activation would finish *after*, creating a handle that gets released
  // invisibly to whoever awaited dispose().
  const activation = deferred<ICapabilityHandle>()
  const dispose = vi.fn()
  const host = enabledHost({}, 'worker')
  host.register({ name: 'worker', activate: () => activation.promise })

  const enabling = host.enable('worker')
  const disposing = host.dispose()
  // Let dispose() run its synchronous disposeSync() phase and enter
  // its wait loop before the activation settles.
  await Promise.resolve()
  activation.resolve(handleOf(dispose))

  await disposing
  expect(dispose).toHaveBeenCalledTimes(1)
  await enabling
}

/**
 * Executes the existing case: publishes activation before synchronous activate disposal and waits
 * for late cleanup.
 */
async function verifyPublishesActivationBeforeSynchronousActivateDisposalAndWaitsForLateCleanup(): Promise<void> {
  const cleanup = deferred<void>()
  const dispose = vi.fn(() => cleanup.promise)
  let internalDispose!: Promise<void>
  let host!: ReturnType<typeof createCapabilityHost<undefined>>
  host = enabledHost(undefined, 'worker')
  host.register({
    name: 'worker',
    activate: () => {
      internalDispose = host.dispose()
      return { dispose }
    }
  })

  const enabling = host.enable('worker')
  expect(host.disposed).toBe(true)
  await expect(host.dispose()).rejects.toEqual(
    expect.objectContaining({
      source: 'capability',
      code: CapabilityErrorCode.hostTransitioning
    })
  )

  let settled = false
  void internalDispose.then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)

  cleanup.resolve()
  await expect(internalDispose).resolves.toBeUndefined()
  await expect(enabling).resolves.toEqual({ status: 'cancelled' })
  expect(dispose).toHaveBeenCalledOnce()
  expect(host.state('worker')).toBe('off')
  expect(host.handle('worker')).toBeUndefined()
}

/**
 * Executes the existing case: disable() waits for that entry's activation still in flight, not just
 * already-tracked releases.
 */
async function verifyDisableWaitsForThatEntrySActivationStillInFlightNotJustAlreadyTrackedReleases(): Promise<void> {
  const activation = deferred<ICapabilityHandle>()
  const dispose = vi.fn()
  const host = enabledHost({}, 'worker')
  host.register({ name: 'worker', activate: () => activation.promise })

  const enabling = host.enable('worker')
  const disabling = host.disable('worker')
  await Promise.resolve()
  activation.resolve(handleOf(dispose))

  await disabling
  expect(dispose).toHaveBeenCalledTimes(1)
  await enabling
  await host.dispose()
}

/** Executes the existing case: discards an in-flight activation that the host outlived. */
async function verifyDiscardsAnInFlightActivationThatTheHostOutlived(): Promise<void> {
  const gate = deferred<ICapabilityHandle>()
  const handle = handleOf()
  const host = enabledHost(undefined, 'persist')
  host.register({ name: 'persist', activate: () => gate.promise })

  const enabling = host.enable('persist')
  const disposing = host.dispose()
  gate.resolve(handle)

  await disposing
  await expect(enabling).resolves.toEqual({ status: 'cancelled' })
  expect(handle.dispose).toHaveBeenCalledTimes(1)
}

/** Executes the existing case: disposes in reverse activation order. */
async function verifyDisposesInReverseActivationOrder(): Promise<void> {
  const order: string[] = []
  const host = enabledHost(undefined, 'persist', 'devtools', 'worker')
  for (const name of ['persist', 'devtools', 'worker']) {
    /** Each loop iteration retains its own release name without nested activation callbacks. */
    const cleanup = new RecordedCapabilityRelease(order, name)
    host.register({ name, activate: async () => ({ dispose: cleanup.dispose }) })
  }

  await host.enable('worker')
  await host.enable('persist')
  await host.enable('devtools')
  await host.dispose()

  expect(order).toEqual(['devtools', 'persist', 'worker'])
  expect(host.disposed).toBe(true)
}
