import { RecordedCapabilityRelease, ReentrantCapabilityRelease } from './fixtures/host-cleanup.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createCapabilityHost,
  CapabilityErrorCode,
  type ICapabilityEnableResult,
  type ICapabilityHandle
} from '../src/index.js'
import { handleOf, deferred, enabledHost } from './fixtures/capability-host.js'

/** Existing host cases grouped by one lifecycle concern; assertions remain unchanged. */
describe('能力闸门：配置快照、回退与重入', () => {
  it(
    'fails closed when a replacement flag snapshot cannot be inspected',
    verifyFailsClosedWhenAReplacementFlagSnapshotCannotBeInspected
  )

  it(
    'turns setFlag(false) into an atomic rollback and can explicitly reopen',
    verifyTurnsSetFlagFalseIntoAnAtomicRollbackAndCanExplicitlyReopen
  )

  it(
    'replaces the complete flag snapshot so an omitted old allow cannot survive',
    verifyReplacesTheCompleteFlagSnapshotSoAnOmittedOldAllowCannotSurvive
  )

  it(
    'releases a multi-flag rollback in reverse activation order',
    verifyReleasesAMultiFlagRollbackInReverseActivationOrder
  )

  it(
    'contains a later disposer failure and still completes LIFO rollback',
    verifyContainsALaterDisposerFailureAndStillCompletesLIFORollback
  )

  it(
    'rejects disposer reentry without letting it rewrite the outer flag snapshot',
    verifyRejectsDisposerReentryWithoutLettingItRewriteTheOuterFlagSnapshot
  )

  it(
    'discards an in-flight activation that was disabled meanwhile',
    verifyDiscardsAnInFlightActivationThatWasDisabledMeanwhile
  )
})

/** Executes the existing case: fails closed when a replacement flag snapshot cannot be inspected. */
async function verifyFailsClosedWhenAReplacementFlagSnapshotCannotBeInspected(): Promise<void> {
  const handle = handleOf()
  const host = enabledHost(undefined, 'persist')
  host.register({ name: 'persist', activate: async () => handle })
  await host.enable('persist')
  const unreadable = new Proxy({} as Record<string, boolean>, {
    ownKeys() {
      throw new Error('flag service payload is unreadable')
    }
  })

  expect(() => host.setFlags(unreadable)).toThrow(
    expect.objectContaining({
      code: CapabilityErrorCode.invalidOption,
      cause: expect.objectContaining({ message: 'flag service payload is unreadable' })
    })
  )
  expect(host.state('persist')).toBe('gated')
  expect(handle.dispose).toHaveBeenCalledTimes(1)
  await expect(host.enable('persist')).resolves.toEqual({ status: 'gated' })
  await host.dispose()
}

/**
 * Executes the existing case: turns setFlag(false) into an atomic rollback and can explicitly
 * reopen.
 */
async function verifyTurnsSetFlagFalseIntoAnAtomicRollbackAndCanExplicitlyReopen(): Promise<void> {
  const first = handleOf()
  const second = handleOf()
  const activate = vi
    .fn<() => Promise<ICapabilityHandle>>()
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce(second)
  const host = enabledHost(undefined, 'persist')
  host.register({ name: 'persist', activate })

  await host.enable('persist')
  host.setFlag('persist', false)
  expect(first.dispose).toHaveBeenCalledTimes(1)
  expect(host.state('persist')).toBe('gated')
  await expect(host.enable('persist')).resolves.toEqual({ status: 'gated' })

  host.setFlag('persist', true)
  expect(host.state('persist')).toBe('off')
  await expect(host.enable('persist')).resolves.toEqual({ status: 'enabled' })
  expect(host.handle('persist')).toBe(second)
  await host.dispose()
}

/**
 * Executes the existing case: replaces the complete flag snapshot so an omitted old allow cannot
 * survive.
 */
async function verifyReplacesTheCompleteFlagSnapshotSoAnOmittedOldAllowCannotSurvive(): Promise<void> {
  const persist = handleOf()
  const worker = handleOf()
  const host = enabledHost(undefined, 'persist', 'worker')
  host.register({ name: 'persist', activate: async () => persist })
  host.register({ name: 'worker', activate: async () => worker })
  await Promise.all([host.enable('persist'), host.enable('worker')])

  host.setFlags({ worker: true })

  expect(host.state('persist')).toBe('gated')
  expect(persist.dispose).toHaveBeenCalledTimes(1)
  expect(host.state('worker')).toBe('on')
  expect(worker.dispose).not.toHaveBeenCalled()
  await host.dispose()
}

/** Executes the existing case: releases a multi-flag rollback in reverse activation order. */
async function verifyReleasesAMultiFlagRollbackInReverseActivationOrder(): Promise<void> {
  const order: string[] = []
  const host = enabledHost(undefined, 'foundation', 'dependent')
  // Registration order deliberately differs from activation order.
  /** Cleanup fixture keeps release order and failure timing under the host's disposer call. */
  const releaseDependent = new RecordedCapabilityRelease(order, 'dependent')
  host.register({
    name: 'dependent',
    activate: async () => ({ dispose: releaseDependent.dispose })
  })
  /** Cleanup fixture keeps release order and failure timing under the host's disposer call. */
  const releaseFoundation = new RecordedCapabilityRelease(order, 'foundation')
  host.register({
    name: 'foundation',
    activate: async () => ({ dispose: releaseFoundation.dispose })
  })
  await host.enable('foundation')
  await host.enable('dependent')

  host.setFlags({})

  expect(order).toEqual(['dependent', 'foundation'])
  expect(host.state('foundation')).toBe('gated')
  expect(host.state('dependent')).toBe('gated')
  await host.dispose()
}

/** Executes the existing case: contains a later disposer failure and still completes LIFO rollback. */
async function verifyContainsALaterDisposerFailureAndStillCompletesLIFORollback(): Promise<void> {
  const order: string[] = []
  const onError = vi.fn()
  const host = createCapabilityHost(undefined, {
    flags: { foundation: true, dependent: true },
    onError
  })
  /** Cleanup fixture keeps release order and failure timing under the host's disposer call. */
  const releaseFoundation = new RecordedCapabilityRelease(order, 'foundation')
  host.register({
    name: 'foundation',
    activate: async () => ({ dispose: releaseFoundation.dispose })
  })
  /** Cleanup fixture keeps release order and failure timing under the host's disposer call. */
  const releaseDependent = new RecordedCapabilityRelease(
    order,
    'dependent',
    undefined,
    'dependent cleanup failed'
  )
  host.register({
    name: 'dependent',
    activate: async () => ({ dispose: releaseDependent.dispose })
  })
  await host.enable('foundation')
  await host.enable('dependent')

  expect(() => host.setFlags({})).not.toThrow()

  expect(order).toEqual(['dependent', 'foundation'])
  expect(host.state('dependent')).toBe('gated')
  expect(host.state('foundation')).toBe('gated')
  expect(onError).toHaveBeenCalledWith(
    'dependent',
    expect.objectContaining({ message: 'dependent cleanup failed' })
  )
  await host.dispose()
}

/**
 * Executes the existing case: rejects disposer reentry without letting it rewrite the outer flag
 * snapshot.
 */
async function verifyRejectsDisposerReentryWithoutLettingItRewriteTheOuterFlagSnapshot(): Promise<void> {
  let host!: ReturnType<typeof createCapabilityHost<undefined>>
  /** Structured activation rejection retained until the outer transition finishes. */
  let enableDuringDispose: Promise<ICapabilityEnableResult> | undefined
  /** Awaitable disable rejects reentry instead of throwing synchronously. */
  let disableDuringDispose: Promise<boolean> | undefined
  const reentryErrors: unknown[] = []
  host = enabledHost(undefined, 'persist')
  /** Reentry fixture retains the same errors and exact operation promises for unchanged assertions. */
  const release = new ReentrantCapabilityRelease(host, reentryErrors, (disabling, enabling) => {
    disableDuringDispose = disabling
    enableDuringDispose = enabling
  })
  host.register({ name: 'persist', activate: async () => ({ dispose: release.dispose }) })
  await host.enable('persist')

  host.setFlags({})

  expect(reentryErrors).toHaveLength(2)
  for (const error of reentryErrors) {
    expect(error).toEqual(
      expect.objectContaining({
        message: 'capability host cannot mutate during a lifecycle transition'
      })
    )
  }
  await expect(disableDuringDispose).rejects.toThrow('lifecycle transition')
  await expect(enableDuringDispose).rejects.toThrow('lifecycle transition')
  expect(host.state('persist')).toBe('gated')
  expect(host.handle('persist')).toBeUndefined()
  await expect(host.enable('persist')).resolves.toEqual({ status: 'gated' })
  await host.dispose()
}

/** Executes the existing case: discards an in-flight activation that was disabled meanwhile. */
async function verifyDiscardsAnInFlightActivationThatWasDisabledMeanwhile(): Promise<void> {
  // 回退最难的一格：开关已经翻回去了，而上一次激活的动态 import 才刚落地。
  // 采纳那个结果等于「关掉的能力几毫秒后自己回来」。
  const gate = deferred<ICapabilityHandle>()
  const handle = handleOf()
  const host = enabledHost(undefined, 'persist')
  host.register({ name: 'persist', activate: () => gate.promise })

  const enabling = host.enable('persist')
  expect(host.state('persist')).toBe('activating')
  /** Disable starts revocation immediately and settles after the pending handle is cleaned up. */
  const disabling = host.disable('persist')
  gate.resolve(handle)

  await expect(enabling).resolves.toEqual({ status: 'cancelled' })
  await disabling
  expect(host.state('persist')).toBe('off')
  expect(host.handle('persist')).toBeUndefined()
  // 作废不等于泄漏：刚建出来的东西要就地释放
  expect(handle.dispose).toHaveBeenCalledTimes(1)
  await host.dispose()
}
