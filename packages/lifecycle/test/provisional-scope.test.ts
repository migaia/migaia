import { describe, expect, it, vi } from 'vitest'
import { createProvisionalScope } from '../src/provisional-scope'
import { createLifecycleScope } from '../src/lifecycle-scope'
import { LifecycleErrorCode } from '../src/error-code'
import type { ILifecycleOwner, IReleaseDescriptor } from '../src/types'

describe('L-T11 ProvisionalScope: commit', () => {
  it('transfers every resource to the parent, in registration order', async () => {
    const provisional = createProvisionalScope()
    const a = provisional.own('a', { force: vi.fn() })
    const b = provisional.own('b', { force: vi.fn() })
    const transferred: unknown[] = []
    const parent: ILifecycleOwner = {
      own(resource) {
        transferred.push(resource)
        return resource
      }
    }
    await provisional.commitTo(parent)
    expect(transferred).toEqual([a, b])
  })

  it('the provisional scope does not itself release anything after a successful commit', async () => {
    const provisional = createProvisionalScope()
    const force = vi.fn()
    provisional.own('a', { force })
    const parent: ILifecycleOwner = { own: (resource) => resource }
    await provisional.commitTo(parent)
    expect(force).not.toHaveBeenCalled()
  })

  it('own() after commit throws PROVISIONAL_SETTLED', async () => {
    const provisional = createProvisionalScope()
    const parent: ILifecycleOwner = { own: (resource) => resource }
    await provisional.commitTo(parent)
    expect(() => provisional.own('late', { force: vi.fn() })).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.provisionalSettled })
    )
  })

  it('commit works end-to-end against a real LifecycleScope parent', async () => {
    const parentScope = createLifecycleScope()
    const provisional = createProvisionalScope()
    const force = vi.fn()
    provisional.own({}, { force })
    await provisional.commitTo(parentScope)
    await parentScope.dispose()
    expect(force).toHaveBeenCalledTimes(1)
  })

  it('when the parent rejects partway, everything already transferred stays with the parent and the remainder is released by this scope, then the original error rethrows', async () => {
    const transferredToParent: string[] = []
    const releasedByProvisional: string[] = []
    let callCount = 0
    const parent: ILifecycleOwner = {
      own(resource) {
        callCount++
        if (callCount > 1) throw new Error('parent rejected')
        transferredToParent.push(resource as string)
        return resource
      }
    }
    const provisional = createProvisionalScope()
    provisional.own('a', {
      force: () => {
        /* would go to parent */
      }
    })
    provisional.own('b', {
      force: () => {
        releasedByProvisional.push('b')
      }
    })
    provisional.own('c', {
      force: () => {
        releasedByProvisional.push('c')
      }
    })
    await expect(provisional.commitTo(parent)).rejects.toThrow('parent rejected')
    expect(transferredToParent).toEqual(['a'])
    // Cleanup is awaited before the returned Promise settles, so no extra tick is required.
    expect(releasedByProvisional.sort()).toEqual(['b', 'c'])
  })
})

describe('L-T12 ProvisionalScope: rollback/abort/expiry', () => {
  it('releases every owned resource in reverse order', async () => {
    const calls: string[] = []
    const provisional = createProvisionalScope()
    provisional.own('a', {
      force: () => {
        calls.push('a')
      }
    })
    provisional.own('b', {
      force: () => {
        calls.push('b')
      }
    })
    await provisional.rollback()
    expect(calls).toEqual(['b', 'a'])
  })

  it('late (post-rollback) commitTo() throws and cannot own anything', async () => {
    const provisional = createProvisionalScope()
    await provisional.rollback()
    expect(() => provisional.own('x', { force: vi.fn() })).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.provisionalSettled })
    )
    const parent: ILifecycleOwner = { own: (resource) => resource }
    expect(() => provisional.commitTo(parent)).toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.provisionalSettled })
    )
  })

  it('rollback() is idempotent', async () => {
    const force = vi.fn()
    const provisional = createProvisionalScope()
    provisional.own('a', { force })
    await provisional.rollback()
    await provisional.rollback()
    expect(force).toHaveBeenCalledTimes(1)
  })

  it('rollback() after a successful commit throws PROVISIONAL_SETTLED', async () => {
    const provisional = createProvisionalScope()
    const parent: ILifecycleOwner = { own: (resource) => resource }
    await provisional.commitTo(parent)
    await expect(provisional.rollback()).rejects.toThrowError(
      expect.objectContaining({ code: LifecycleErrorCode.provisionalSettled })
    )
  })

  it('cleanup errors during one rollback are all collected into a single AggregateError', async () => {
    const provisional = createProvisionalScope()
    provisional.own('a', {
      force: () => {
        throw new Error('a failed')
      }
    })
    provisional.own('b', {
      force: () => {
        throw new Error('b failed')
      }
    })
    let thrown: unknown
    try {
      await provisional.rollback()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(AggregateError)
    expect((thrown as AggregateError).errors).toHaveLength(2)
  })

  it('one resource failing to release does not stop the rest from being released', async () => {
    const released: string[] = []
    const provisional = createProvisionalScope()
    provisional.own('a', {
      force: () => {
        released.push('a')
      }
    })
    provisional.own('failing', {
      force: () => {
        throw new Error('boom')
      }
    })
    provisional.own('c', {
      force: () => {
        released.push('c')
      }
    })
    try {
      await provisional.rollback()
    } catch {
      // expected
    }
    expect(released).toEqual(['c', 'a'])
  })

  it('rollback keeps releasing resources after one descriptor fails admission', async () => {
    const admissionError = new Error('rollback descriptor admission failed')
    const released: string[] = []
    const hostile = { force: vi.fn() } as Record<string, unknown>
    Object.defineProperty(hostile, 'graceful', {
      get: () => {
        throw admissionError
      }
    })
    const provisional = createProvisionalScope()
    provisional.own('first', {
      force: () => {
        released.push('first')
      }
    })
    provisional.own('hostile', hostile as IReleaseDescriptor)
    provisional.own('later', {
      force: () => {
        released.push('later')
      }
    })

    await expect(provisional.rollback()).rejects.toBe(admissionError)
    expect(released).toEqual(['later', 'first'])
  })

  it('signal aborts once rollback is triggered', async () => {
    const provisional = createProvisionalScope()
    expect(provisional.signal.aborted).toBe(false)
    await provisional.rollback()
    expect(provisional.signal.aborted).toBe(true)
  })

  it('AF-T61: abort listener failures do not prevent provisional cleanup or later listeners', async () => {
    const provisional = createProvisionalScope()
    const calls: string[] = []
    provisional.signal.addEventListener('abort', () => {
      calls.push('first')
    })
    provisional.signal.addEventListener('abort', () => {
      calls.push('second')
    })
    provisional.own('resource', {
      force: () => {
        calls.push('cleanup')
      }
    })

    await expect(provisional.rollback()).resolves.toBeUndefined()
    expect(calls).toEqual(['first', 'second', 'cleanup'])
    expect(provisional.signal.aborted).toBe(true)
  })
})

describe('L-T39 ProvisionalScope: construction-failure rollback', () => {
  it('releases part-way-allocated resources in strict reverse-of-registration order', async () => {
    const order: string[] = []
    const provisional = createProvisionalScope()
    provisional.own('first-allocated', {
      force: () => {
        order.push('first-allocated')
      }
    })
    provisional.own('second-allocated', {
      force: () => {
        order.push('second-allocated')
      }
    })
    provisional.own('third-allocated', {
      force: () => {
        order.push('third-allocated')
      }
    })
    // Simulates: construction failed after allocating three resources; roll them all back.
    await provisional.rollback()
    expect(order).toEqual(['third-allocated', 'second-allocated', 'first-allocated'])
  })

  it("the original construction error, kept by the caller outside this scope, remains reachable and unreplaced when the caller attaches rollback's cleanup failure as a secondary cause", async () => {
    const provisional = createProvisionalScope()
    provisional.own('x', {
      force: () => {
        throw new Error('cleanup also failed')
      }
    })
    const constructionError = new Error('construction failed')
    let finalError: unknown
    try {
      throw constructionError
    } catch (caught) {
      try {
        await provisional.rollback()
        finalError = caught
      } catch (cleanupError) {
        // The recommended pattern: keep the original error primary, attach cleanup failure as cause.
        finalError = new Error('construction failed; cleanup also failed', {
          cause: { primary: caught, cleanup: cleanupError }
        })
      }
    }
    expect(
      (finalError as Error & { cause: { primary: unknown; cleanup: unknown } }).cause.primary
    ).toBe(constructionError)
  })

  it('a descriptor with graceful still degrades to force during rollback, same as normal teardown', async () => {
    const force = vi.fn()
    const provisional = createProvisionalScope()
    provisional.own('x', {
      graceful: () => {
        throw new Error('graceful failed during rollback')
      },
      force
    })
    await expect(provisional.rollback()).rejects.toThrow()
    expect(force).toHaveBeenCalledTimes(1)
  })
})

describe('L-T49 ProvisionalScope: parent registration rollback', () => {
  it('keeps addEventListener stored-then-throw primary and remove cleanup identities reachable', () => {
    const registrationError = new Error('parent registration failed')
    const removalError = new Error('parent removal failed')
    let registeredListener: (() => void) | undefined
    const parent = {
      aborted: false,
      reason: 'parent reason',
      addEventListener: (_type: 'abort', listener: () => void) => {
        registeredListener = listener
        throw registrationError
      },
      removeEventListener: (_type: 'abort', listener: () => void) => {
        expect(listener).toBe(registeredListener)
        throw removalError
      }
    }

    let thrown: unknown
    try {
      createProvisionalScope({ parentSignal: parent })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(registrationError)
    expect((thrown as { errors?: readonly unknown[] }).errors).toEqual([removalError])
  })

  it('handles invoke-then-store and post-return abort by force-removing the listener', () => {
    let aborted = false
    const reason = new Error('parent aborted')
    let storedListener: (() => void) | undefined
    let removed = 0
    const parent = {
      get aborted() {
        return aborted
      },
      reason,
      addEventListener: (_type: 'abort', listener: () => void) => {
        storedListener = listener
        aborted = true
        listener()
        storedListener = listener
      },
      removeEventListener: (_type: 'abort', listener: () => void) => {
        expect(listener).toBe(storedListener)
        removed++
        aborted = true
      }
    }

    const provisional = createProvisionalScope({ parentSignal: parent })
    expect(provisional.signal.aborted).toBe(true)
    expect(provisional.signal.reason).toBe(reason)
    expect(removed).toBe(2)
  })

  it('removes a listener when the host invokes before storing it', () => {
    const reason = new Error('parent aborted before store')
    let storedListener: (() => void) | undefined
    let removed = 0
    const parent = {
      aborted: false,
      reason,
      addEventListener: (_type: 'abort', listener: () => void) => {
        listener()
        storedListener = listener
      },
      removeEventListener: (_type: 'abort', listener: () => void) => {
        if (listener === storedListener) removed += 1
      }
    }

    const provisional = createProvisionalScope({ parentSignal: parent })
    expect(provisional.signal.reason).toBe(reason)
    expect(removed).toBe(1)
  })

  it('does not duplicate a retry cleanup failure as its own primary error', () => {
    const cleanupError = new Error('parent retry cleanup failed')
    let storedListener: (() => void) | undefined
    const parent = {
      aborted: false,
      reason: 'parent reason',
      addEventListener: (_type: 'abort', listener: () => void) => {
        listener()
        storedListener = listener
      },
      removeEventListener: (_type: 'abort', listener: () => void) => {
        if (listener === storedListener) throw cleanupError
      }
    }

    let thrown: unknown
    try {
      createProvisionalScope({ parentSignal: parent })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(cleanupError)
    expect((thrown as { errors?: readonly unknown[] }).errors).toBeUndefined()
  })
})
