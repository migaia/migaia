import { describe, expect, it, vi } from 'vitest'
import {
  CapabilityErrorCode,
  snapshotGraphReadiness,
  type ICapabilityReadinessSource
} from '../src/index.js'

describe('graph readiness adapter', () => {
  it(
    'reads state then error once and freezes snapshot',
    verifyReadsStateThenErrorOnceAndFreezesSnapshot
  )

  it(
    'preserves getter error and stops before error getter',
    verifyPreservesGetterErrorAndStopsBeforeErrorGetter
  )

  it(
    'wraps a non-Error state getter failure and stops before error getter',
    verifyWrapsANonErrorStateGetterFailureAndStopsBeforeErrorGetter
  )

  it(
    'preserves error getter Error identity, stack, and cause',
    verifyPreservesErrorGetterErrorIdentityStackAndCause
  )

  it(
    'wraps a non-Error error getter failure with the original cause',
    verifyWrapsANonErrorErrorGetterFailureWithTheOriginalCause
  )

  it('fails closed for invalid state', verifyFailsClosedForInvalidState)

  it.each(['ready', 'blocked', 'failed'] as const)('admits %s', verifyAdmitsS)

  it('does not observe later Host changes', verifyDoesNotObserveLaterHostChanges)
})

/** Executes the existing case: reads state then error once and freezes snapshot. */
function verifyReadsStateThenErrorOnceAndFreezesSnapshot(): void {
  const reads: string[] = []
  const source = {
    get state() {
      reads.push('state')
      return 'ready'
    },
    get error() {
      reads.push('error')
      return undefined
    }
  } satisfies ICapabilityReadinessSource
  const snapshot = snapshotGraphReadiness(source)
  expect(reads).toEqual(['state', 'error'])
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(snapshot).toEqual({ state: 'ready', error: undefined })
}

/** Executes the existing case: preserves getter error and stops before error getter. */
function verifyPreservesGetterErrorAndStopsBeforeErrorGetter(): void {
  const failure = new TypeError('host getter failed')
  const errorGetter = vi.fn()
  const source = {
    get state(): never {
      throw failure
    },
    get error() {
      errorGetter()
      return undefined
    }
  } satisfies ICapabilityReadinessSource
  expect(() => snapshotGraphReadiness(source)).toThrow(failure)
  expect(errorGetter).not.toHaveBeenCalled()
}

/** Executes the existing case: wraps a non-Error state getter failure and stops before error getter. */
function verifyWrapsANonErrorStateGetterFailureAndStopsBeforeErrorGetter(): void {
  const failure = { reason: 'foreign state failure' }
  const errorGetter = vi.fn()
  const source = {
    get state(): never {
      throw failure
    },
    get error() {
      errorGetter()
      return undefined
    }
  } satisfies ICapabilityReadinessSource

  expect(() => snapshotGraphReadiness(source)).toThrow(
    expect.objectContaining({
      code: CapabilityErrorCode.invalidOption,
      cause: failure
    })
  )
  expect(errorGetter).not.toHaveBeenCalled()
}

/** Executes the existing case: preserves error getter Error identity, stack, and cause. */
function verifyPreservesErrorGetterErrorIdentityStackAndCause(): void {
  const cause = new Error('root cause')
  const failure = new TypeError('host error getter failed', { cause })
  const source = {
    state: 'ready',
    get error(): never {
      throw failure
    }
  } satisfies ICapabilityReadinessSource

  let thrown: unknown
  try {
    snapshotGraphReadiness(source)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBe(failure)
  expect((thrown as Error).stack).toBe(failure.stack)
  expect((thrown as Error).cause).toBe(cause)
}

/** Executes the existing case: wraps a non-Error error getter failure with the original cause. */
function verifyWrapsANonErrorErrorGetterFailureWithTheOriginalCause(): void {
  const failure = { reason: 'foreign error failure' }
  const source = {
    state: 'ready',
    get error(): never {
      throw failure
    }
  } satisfies ICapabilityReadinessSource

  expect(() => snapshotGraphReadiness(source)).toThrow(
    expect.objectContaining({
      code: CapabilityErrorCode.invalidOption,
      cause: failure
    })
  )
}

/** Executes the existing case: fails closed for invalid state. */
function verifyFailsClosedForInvalidState(): void {
  const errorGetter = vi.fn()
  const source = {
    state: 'activating',
    get error() {
      errorGetter()
      return undefined
    }
  } satisfies ICapabilityReadinessSource
  expect(() => snapshotGraphReadiness(source)).toThrow(
    expect.objectContaining({ code: CapabilityErrorCode.invalidOption })
  )
  expect(errorGetter).not.toHaveBeenCalled()
}

/** Executes the existing case: admits %s. */
function verifyAdmitsS(state: 'ready' | 'blocked' | 'failed'): void {
  expect(snapshotGraphReadiness({ state, error: undefined }).state).toBe(state)
}

/** Executes the existing case: does not observe later Host changes. */
function verifyDoesNotObserveLaterHostChanges(): void {
  let state: 'ready' | 'failed' = 'ready'
  const source = {
    get state() {
      return state
    },
    error: undefined
  }
  const snapshot = snapshotGraphReadiness(source)
  state = 'failed'
  expect(snapshot.state).toBe('ready')
}
