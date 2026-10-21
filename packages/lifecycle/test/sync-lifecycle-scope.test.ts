import { describe, expect, it, vi } from 'vitest'
import { createSyncLifecycleScope } from '../src/sync-lifecycle-scope'
import { createLifecycleScope } from '../src/lifecycle-scope'
import { createProvisionalScope } from '../src/provisional-scope'
import { LifecycleErrorCode } from '../src/error-code'

describe('SyncLifecycleScope: rejects async descriptors and async-owner instances at registration time', () => {
  it('rejects a descriptor missing syncSafe: true', () => {
    const scope = createSyncLifecycleScope()
    expect(() => scope.own({}, { force: () => {} } as never)).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.scopeSyncViolation })
    )
  })

  it('rejects syncSafe: false explicitly', () => {
    const scope = createSyncLifecycleScope()
    expect(() => scope.own({}, { syncSafe: false, force: () => {} } as never)).toThrow()
  })

  it('never executes a rejected registration’s force during dispose()', () => {
    const scope = createSyncLifecycleScope()
    const force = vi.fn()
    try {
      scope.own({}, { force } as never)
    } catch {
      // expected
    }
    scope.dispose()
    expect(force).not.toHaveBeenCalled()
  })

  it('rejects owning a LifecycleScope instance even with syncSafe: true claimed', () => {
    const sync = createSyncLifecycleScope()
    const asyncChild = createLifecycleScope()
    expect(() => sync.own(asyncChild, { syncSafe: true, force: () => {} })).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.scopeSyncViolation })
    )
  })

  it('rejects owning a ProvisionalScope instance even with syncSafe: true claimed', () => {
    const sync = createSyncLifecycleScope()
    const provisional = createProvisionalScope()
    expect(() => sync.own(provisional, { syncSafe: true, force: () => {} })).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.scopeSyncViolation })
    )
  })

  it('accepts a plain object with syncSafe: true and a synchronous force', () => {
    const scope = createSyncLifecycleScope()
    const force = vi.fn()
    scope.own({}, { syncSafe: true, force })
    scope.dispose()
    expect(force).toHaveBeenCalledTimes(1)
  })

  it('a force() that returns a thenable despite syncSafe: true is treated as a violation, not silently awaited', () => {
    const scope = createSyncLifecycleScope({ errorPolicy: 'collect' })
    scope.own({}, { syncSafe: true, force: () => Promise.resolve() as unknown as void })
    const errors = scope.dispose()
    expect(errors).toHaveLength(1)
    expect((errors[0]!.error as { code: string }).code).toBe(LifecycleErrorCode.scopeSyncViolation)
  })
})

describe('shared release admission', () => {
  it.each(['order', 'force'] as const)(
    're-admits a changed %s before any release runs',
    (field) => {
      /** Collecting keeps a rejected item observable while the remaining resource still releases. */
      const scope = createSyncLifecycleScope({ errorPolicy: 'collect' })
      /** This valid resource proves admission failure cannot discard the remaining plan. */
      const kept = vi.fn()
      /** This callback must never run after its descriptor changes to an invalid shape. */
      const rejected = vi.fn()
      /** Switches getter output only after own() has accepted the original descriptor. */
      let mutated = false
      scope.own('kept', { syncSafe: true, force: kept })
      scope.own('changed', {
        syncSafe: true,
        /** Registration sees a valid order; disposal must reject its later invalid value. */
        get order() {
          return mutated && field === 'order' ? NaN : 0
        },
        /** A previously valid callback can disappear before the descriptor is re-admitted. */
        get force() {
          return mutated && field === 'force' ? (undefined as never) : rejected
        }
      })
      mutated = true
      /** The shared admission policy returns the coded failure synchronously. */
      const errors = scope.dispose()
      expect(errors).toHaveLength(1)
      expect(errors[0].error).toMatchObject({ code: LifecycleErrorCode.invalidOption })
      expect(kept).toHaveBeenCalledTimes(1)
      expect(rejected).not.toHaveBeenCalled()
    }
  )
})

describe('SyncLifecycleScope: dispose() is fully synchronous and returns (not a Promise)', () => {
  it('dispose() return value is a plain array, not a thenable', () => {
    const scope = createSyncLifecycleScope()
    const result = scope.dispose()
    expect(Array.isArray(result)).toBe(true)
  })

  it('releases in LIFO order', () => {
    const calls: string[] = []
    const scope = createSyncLifecycleScope()
    scope.own('a', {
      syncSafe: true,
      force: () => {
        calls.push('a')
      }
    })
    scope.own('b', {
      syncSafe: true,
      force: () => {
        calls.push('b')
      }
    })
    scope.dispose()
    expect(calls).toEqual(['b', 'a'])
  })

  it('close() never calls user code', () => {
    const force = vi.fn()
    const scope = createSyncLifecycleScope()
    scope.own({}, { syncSafe: true, force })
    scope.close()
    expect(force).not.toHaveBeenCalled()
  })

  it('release() unregisters without invoking force', () => {
    const force = vi.fn()
    const scope = createSyncLifecycleScope()
    const resource = scope.own({}, { syncSafe: true, force })
    expect(scope.release(resource)).toBe(true)
    scope.dispose()
    expect(force).not.toHaveBeenCalled()
  })

  it('releases repeated resources oldest first and preserves remaining LIFO order', () => {
    /** Multiple registrations share one resource but retain independent descriptors. */
    const resource = {}
    /** The unrelated registration exposes whether release disturbs insertion order. */
    const other = {}
    /** Only still-owned descriptors may execute at disposal. */
    const calls: string[] = []
    /** Public scope exercises promotion, collapse and later duplicate registration. */
    const scope = createSyncLifecycleScope()
    scope.own(resource, {
      syncSafe: true,
      force: () => {
        calls.push('first')
      }
    })
    scope.own(other, {
      syncSafe: true,
      force: () => {
        calls.push('other')
      }
    })
    scope.own(resource, {
      syncSafe: true,
      force: () => {
        calls.push('second')
      }
    })
    scope.own(resource, {
      syncSafe: true,
      force: () => {
        calls.push('third')
      }
    })
    expect(scope.release(resource)).toBe(true)
    expect(scope.release(resource)).toBe(true)
    scope.own(resource, {
      syncSafe: true,
      force: () => {
        calls.push('fourth')
      }
    })
    expect(scope.release(resource)).toBe(true)
    expect(calls).toEqual([])
    scope.dispose()
    expect(calls).toEqual(['fourth', 'other'])
    expect(scope.release(resource)).toBe(false)
  })
})
