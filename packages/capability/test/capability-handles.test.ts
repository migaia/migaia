import {
  SingleReadCapabilityHandle,
  RejectedCapabilityRelease,
  RejectedCleanupThen,
  thenGetterCapabilityHandle
} from './fixtures/host-cleanup.ts'
import { describe, expect, it, vi } from 'vitest'
import { createCapabilityHost, CapabilityErrorCode, type ICapabilityHandle } from '../src/index.ts'
import { handleOf, deferred, enabledHost } from './fixtures/capability-host.ts'

/** Existing host cases grouped by one lifecycle concern; assertions remain unchanged. */
describe('能力闸门：句柄准入与失败归属', () => {
  it(
    'uses the disposer captured at adoption even if the public handle mutates',
    verifyUsesTheDisposerCapturedAtAdoptionEvenIfThePublicHandleMutates
  )

  it(
    'invokes the captured disposer with the capability handle as receiver',
    verifyInvokesTheCapturedDisposerWithTheCapabilityHandleAsReceiver
  )

  it('reads a hostile disposer getter exactly once', verifyReadsAHostileDisposerGetterExactlyOnce)

  it(
    'classifies a throwing handle disposer getter and converges disable/dispose',
    verifyClassifiesAThrowingHandleDisposerGetterAndConvergesDisableDispose
  )

  it(
    'contains disposal and reporter errors when an in-flight activation is revoked',
    verifyContainsDisposalAndReporterErrorsWhenAnInFlightActivationIsRevoked
  )

  it(
    'contains async disposal and reporter rejections during rollback',
    verifyContainsAsyncDisposalAndReporterRejectionsDuringRollback
  )

  it(
    'reports a stale async cleanup failure without poisoning a replacement generation',
    verifyReportsAStaleAsyncCleanupFailureWithoutPoisoningAReplacementGeneration
  )

  it(
    'does not let a superseded activation cleanup poison the replacement',
    verifyDoesNotLetASupersededActivationCleanupPoisonTheReplacement
  )

  it('reads a disposal then getter only once', verifyReadsADisposalThenGetterOnlyOnce)

  it(
    'contains activation reporter errors and rejects malformed handles as failures',
    verifyContainsActivationReporterErrorsAndRejectsMalformedHandlesAsFailures
  )
})

/**
 * Executes the existing case: uses the disposer captured at adoption even if the public handle
 * mutates.
 */
async function verifyUsesTheDisposerCapturedAtAdoptionEvenIfThePublicHandleMutates(): Promise<void> {
  const original = vi.fn()
  const hijacked = vi.fn()
  const handle = { dispose: original }
  const host = enabledHost({}, 'x')
  host.register({ name: 'x', activate: () => handle })
  await host.enable('x')
  handle.dispose = hijacked
  await host.disable('x')
  expect(original).toHaveBeenCalledOnce()
  expect(hijacked).not.toHaveBeenCalled()
}

/** Executes the existing case: invokes the captured disposer with the capability handle as receiver. */
async function verifyInvokesTheCapturedDisposerWithTheCapabilityHandleAsReceiver(): Promise<void> {
  const handle = {
    released: false,
    dispose() {
      this.released = true
    }
  }
  const host = enabledHost({}, 'receiver')
  host.register({ name: 'receiver', activate: () => handle })
  await host.enable('receiver')
  await host.disable('receiver')
  expect(handle.released).toBe(true)
}

/** Executes the existing case: reads a hostile disposer getter exactly once. */
async function verifyReadsAHostileDisposerGetterExactlyOnce(): Promise<void> {
  /** Getter and disposer counters belong to the hostile handle fixture. */
  const handle = new SingleReadCapabilityHandle()
  const host = enabledHost({}, 'hostile')
  host.register({ name: 'hostile', activate: () => handle })
  await host.enable('hostile')
  await host.disable('hostile')
  expect({ reads: handle.reads, original: handle.original, hijacked: handle.hijacked }).toEqual({
    reads: 1,
    original: 1,
    hijacked: 0
  })
}

/**
 * Executes the existing case: classifies a throwing handle disposer getter and converges
 * disable/dispose.
 */
async function verifyClassifiesAThrowingHandleDisposerGetterAndConvergesDisableDispose(): Promise<void> {
  const getterError = new Error('dispose getter failed')
  let reads = 0
  const handle = {
    get dispose() {
      reads++
      throw getterError
    }
  }
  const reported: unknown[] = []
  const host = createCapabilityHost(undefined, {
    flags: { hostile: true },
    onError: (_name, error) => reported.push(error)
  })
  host.register({ name: 'hostile', activate: () => handle as never })

  await expect(host.enable('hostile')).resolves.toEqual({
    status: 'failed',
    error: expect.objectContaining({
      source: 'capability',
      code: CapabilityErrorCode.invalidHandle,
      cause: getterError
    })
  })
  expect(reads).toBe(1)
  expect(host.handle('hostile')).toBeUndefined()
  expect(host.error('hostile')).toEqual(
    expect.objectContaining({ code: CapabilityErrorCode.invalidHandle, cause: getterError })
  )
  expect(reported).toEqual([
    expect.objectContaining({ code: CapabilityErrorCode.invalidHandle, cause: getterError })
  ])

  await expect(host.disable('hostile')).resolves.toBe(false)
  await expect(host.dispose()).resolves.toBeUndefined()
  expect(host.state('hostile')).toBe('off')
  expect(host.handle('hostile')).toBeUndefined()
}

/**
 * Executes the existing case: contains disposal and reporter errors when an in-flight activation is
 * revoked.
 */
async function verifyContainsDisposalAndReporterErrorsWhenAnInFlightActivationIsRevoked(): Promise<void> {
  /** Reporter containment must preserve its own error on the host channel. */
  const callbacks: (() => void)[] = []
  /** Capture terminal delivery separately from capability settlement. */
  const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    callbacks.push(callback)
  })
  const disposeError = new Error('late handle failed to dispose')
  const reporterError = new Error('reporter failed')
  const onError = vi.fn(() => {
    throw reporterError
  })
  const gate = deferred<ICapabilityHandle>()
  const host = createCapabilityHost(undefined, {
    flags: { worker: true },
    onError
  })
  host.register({ name: 'worker', activate: () => gate.promise })

  const enabling = host.enable('worker')
  host.setFlag('worker', false)
  gate.resolve({
    dispose() {
      throw disposeError
    }
  })

  await expect(enabling).resolves.toEqual({ status: 'gated' })
  expect(host.state('worker')).toBe('gated')
  expect(host.error('worker')).toBe(disposeError)
  expect(onError).toHaveBeenCalledWith('worker', disposeError)
  await host.dispose()
  expect(callbacks).toHaveLength(1)
  expect(callbacks[0]).toThrow(reporterError)
  queue.mockRestore()
}

/** Executes the existing case: contains async disposal and reporter rejections during rollback. */
async function verifyContainsAsyncDisposalAndReporterRejectionsDuringRollback(): Promise<void> {
  /** Async reporter failure uses the same host boundary as a synchronous throw. */
  const callbacks: (() => void)[] = []
  /** Inspect terminal work independently from cleanup. */
  const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    callbacks.push(callback)
  })
  const disposeError = new Error('async dispose failed')
  const reporterError = new Error('async reporter failed')
  const onError = vi.fn(async () => {
    throw reporterError
  })
  const host = createCapabilityHost(undefined, {
    flags: { worker: true },
    onError
  })
  /** Cleanup still rejects only when rollback invokes the disposer. */
  const cleanup = new RejectedCapabilityRelease(disposeError)
  host.register({ name: 'worker', activate: async () => ({ dispose: cleanup.dispose }) })

  await expect(host.enable('worker')).resolves.toEqual({ status: 'enabled' })
  host.setFlag('worker', false)
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()

  expect(host.state('worker')).toBe('gated')
  expect(host.error('worker')).toBe(disposeError)
  expect(onError).toHaveBeenCalledWith('worker', disposeError)
  await host.dispose()
  for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  expect(callbacks).toHaveLength(1)
  expect(callbacks[0]).toThrow(reporterError)
  queue.mockRestore()
}

/**
 * Executes the existing case: reports a stale async cleanup failure without poisoning a replacement
 * generation.
 */
async function verifyReportsAStaleAsyncCleanupFailureWithoutPoisoningAReplacementGeneration(): Promise<void> {
  const cleanup = deferred<void>()
  const reported = deferred<void>()
  const cleanupError = new Error('old generation cleanup failed')
  const onError = vi.fn(() => reported.resolve(undefined))
  const replacement = handleOf()
  const activate = vi
    .fn<() => Promise<ICapabilityHandle>>()
    .mockResolvedValueOnce({
      dispose: async () => {
        await cleanup.promise
        throw cleanupError
      }
    })
    .mockResolvedValueOnce(replacement)
  const host = createCapabilityHost(undefined, {
    flags: { worker: true },
    onError
  })
  host.register({ name: 'worker', activate })
  await host.enable('worker')

  host.setFlag('worker', false)
  host.setFlag('worker', true)
  await expect(host.enable('worker')).resolves.toEqual({ status: 'enabled' })
  cleanup.resolve(undefined)
  await reported.promise

  expect(host.state('worker')).toBe('on')
  expect(host.handle('worker')).toBe(replacement)
  expect(host.error('worker')).toBeUndefined()
  expect(onError).toHaveBeenCalledWith('worker', cleanupError)
  await host.dispose()
}

/** Executes the existing case: does not let a superseded activation cleanup poison the replacement. */
async function verifyDoesNotLetASupersededActivationCleanupPoisonTheReplacement(): Promise<void> {
  const staleActivation = deferred<ICapabilityHandle>()
  const cleanup = deferred<void>()
  const cleanupError = new Error('superseded activation cleanup failed')
  const replacement = handleOf()
  const onError = vi.fn()
  const activate = vi
    .fn<() => Promise<ICapabilityHandle>>()
    .mockReturnValueOnce(staleActivation.promise)
    .mockResolvedValueOnce(replacement)
  const host = createCapabilityHost(undefined, {
    flags: { worker: true },
    onError
  })
  host.register({ name: 'worker', activate })

  const staleEnable = host.enable('worker')
  /** Trigger synchronous revocation now; await physical cleanup after releasing the old task. */
  const disabling = host.disable('worker')
  await expect(host.enable('worker')).resolves.toEqual({ status: 'enabled' })
  staleActivation.resolve({
    dispose: async () => {
      await cleanup.promise
      throw cleanupError
    }
  })
  await expect(staleEnable).resolves.toEqual({ status: 'cancelled' })
  cleanup.resolve(undefined)
  await disabling
  await vi.waitFor(() => {
    expect(onError).toHaveBeenCalledWith('worker', cleanupError)
  })

  expect(host.state('worker')).toBe('on')
  expect(host.handle('worker')).toBe(replacement)
  expect(host.error('worker')).toBeUndefined()
  await host.dispose()
}

/** Executes the existing case: reads a disposal then getter only once. */
async function verifyReadsADisposalThenGetterOnlyOnce(): Promise<void> {
  const failure = new Error('thenable cleanup failed')
  /** Protocol fixture owns the exact cleanup failure and mockable then getter. */
  const cleanup = new RejectedCleanupThen(failure)
  const getThen = vi.fn(cleanup.getThen)
  const host = enabledHost(undefined, 'worker')
  host.register({ name: 'worker', activate: async () => thenGetterCapabilityHandle(getThen) })

  await host.enable('worker')
  host.setFlag('worker', false)
  await Promise.resolve()

  expect(getThen).toHaveBeenCalledTimes(1)
  expect(host.error('worker')).toBe(failure)
  await host.dispose()
}

/**
 * Executes the existing case: contains activation reporter errors and rejects malformed handles as
 * failures.
 */
async function verifyContainsActivationReporterErrorsAndRejectsMalformedHandlesAsFailures(): Promise<void> {
  /** Failed activation and failed reporting are separately observable. */
  const callbacks: (() => void)[] = []
  /** Capture terminal reporting without throwing into the test host. */
  const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
    callbacks.push(callback)
  })
  /** Exact reporter error must survive the final boundary. */
  const reporterError = new Error('reporter failed')
  const onError = vi.fn(() => {
    throw reporterError
  })
  const host = createCapabilityHost(undefined, {
    flags: { malformed: true },
    onError
  })
  host.register({
    name: 'malformed',
    activate: async () => null as unknown as ICapabilityHandle
  })

  await expect(host.enable('malformed')).resolves.toMatchObject({
    status: 'failed',
    error: expect.any(Error)
  })
  expect(host.state('malformed')).toBe('failed')
  expect(String(host.error('malformed'))).toContain('invalid handle')
  expect(onError).toHaveBeenCalledTimes(1)
  await host.dispose()
  expect(callbacks).toHaveLength(1)
  expect(callbacks[0]).toThrow(reporterError)
  queue.mockRestore()
}
