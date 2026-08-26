import { describe, expect, it, vi } from 'vitest'
import { createSyncLifecycleScope } from '../src/sync-lifecycle-scope'
import { createLifecycleScope } from '../src/lifecycle-scope'
import { createProvisionalScope } from '../src/provisional-scope'
import { LifecycleErrorCode } from '../src/error-code'

describe('L-T4 SyncLifecycleScope: rejects async descriptors and async-owner instances at registration time', () => {
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
})
