import { describe, expect, it, vi } from 'vitest'
import { createLifecycleScope } from '../src/lifecycle-scope.ts'
import { LifecycleErrorCode } from '../src/error-code.ts'
import type { IReleaseDescriptor } from '../src/types.ts'

const forceDescriptor = (force: IReleaseDescriptor['force']): IReleaseDescriptor => ({ force })

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('LifecycleScope: own/release/dispose', () => {
  it('release() unregisters a resource without releasing it', async () => {
    const force = vi.fn()
    const scope = createLifecycleScope()
    const resource = scope.own({}, forceDescriptor(force))
    expect(scope.release(resource)).toBe(true)
    await scope.dispose()
    expect(force).not.toHaveBeenCalled()
  })

  it('release() returns false for an unknown resource', () => {
    const scope = createLifecycleScope()
    expect(scope.release({})).toBe(false)
  })

  it('close()-then-dispose(): resources present at close() are released in reverse order (snapshot)', async () => {
    const calls: string[] = []
    const scope = createLifecycleScope()
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a')
      })
    )
    scope.own(
      'b',
      forceDescriptor(() => {
        calls.push('b')
      })
    )
    await scope.dispose()
    expect(calls).toEqual(['b', 'a'])
  })

  it('own() during closing/terminal throws and does not add a new resource', async () => {
    const scope = createLifecycleScope()
    scope.own(
      'a',
      forceDescriptor(() => {})
    )
    const disposePromise = scope.dispose()
    expect(() =>
      scope.own(
        'b',
        forceDescriptor(() => {})
      )
    ).toThrowError(expect.objectContaining({ code: LifecycleErrorCode.scopeClosed }))
    await disposePromise
    expect(() =>
      scope.own(
        'c',
        forceDescriptor(() => {})
      )
    ).toThrowError(expect.objectContaining({ code: LifecycleErrorCode.scopeTerminal }))
  })
})

describe('LifecycleScope descriptor admission boundary', () => {
  it.each(['throw', 'collect', 'report', 'firstError'] as const)(
    'reads a force getter once at own() and releases that snapshot in order under %s policy',
    async (errorPolicy) => {
      const calls: string[] = []
      const report = vi.fn()
      const hostile = { order: 0 } as Record<string, unknown>
      // own() snapshots the descriptor; a getter that would fail later is never read again.
      const forceGetter = vi.fn((): unknown => {
        if (forceGetter.mock.calls.length === 1)
          return () => {
            calls.push('hostile')
          }
        throw new Error('hostile force getter read twice')
      })
      Object.defineProperty(hostile, 'force', { get: forceGetter })
      const scope = createLifecycleScope({ errorPolicy, report })

      scope.own('low', {
        order: 0,
        force: () => {
          calls.push('low')
        }
      })
      scope.own('hostile', hostile as IReleaseDescriptor)
      scope.own('high', {
        order: 10,
        force: () => {
          calls.push('high')
        }
      })

      expect(forceGetter).toHaveBeenCalledTimes(1)
      await expect(scope.dispose()).resolves.toEqual([])
      expect(report).not.toHaveBeenCalled()
      expect(forceGetter).toHaveBeenCalledTimes(1)
      expect(calls).toEqual(['high', 'hostile', 'low'])
      expect(scope.lifecycle).toBe('terminal')
    }
  )
})

describe('LifecycleScope: sync/async reentrancy', () => {
  it('a synchronous disposer that reentrantly calls dispose() is rejected, error attributed to it, rest continues', async () => {
    const calls: string[] = []
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a')
      })
    )
    scope.own(
      'reentrant',
      forceDescriptor(() => {
        expect(() => scope.dispose()).toThrowError(
          expect.objectContaining({ code: LifecycleErrorCode.scopeReentrantDispose })
        )
        calls.push('reentrant-caught-locally')
      })
    )
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c')
      })
    )
    const errors = await scope.dispose()
    expect(calls).toEqual(['c', 'reentrant-caught-locally', 'a'])
    // The reentrant scope.dispose() call was caught locally by this test's own try, so it never
    // reaches the sink — that's fine, this proves attribution via normal call-stack propagation
    // when the disposer does NOT itself catch it (see next test).
    expect(errors).toEqual([])
  })

  it('an uncaught reentrant dispose() from within a disposer is attributed to that disposer, others continue', async () => {
    const calls: string[] = []
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a')
      })
    )
    scope.own(
      'reentrant',
      forceDescriptor(() => {
        calls.push('reentrant')
        scope.dispose() // not caught here — propagates up through this disposer's own execution
      })
    )
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c')
      })
    )
    const errors = await scope.dispose()
    expect(calls).toEqual(['c', 'reentrant', 'a'])
    expect(errors).toHaveLength(1)
    expect((errors[0]!.error as { code: string }).code).toBe(
      LifecycleErrorCode.scopeReentrantDispose
    )
    expect(errors[0]!.source).toBeDefined()
  })

  it('an async disposer continuation joins the existing dispose promise outside its active callback', async () => {
    const calls: string[] = []
    let joined: Promise<readonly unknown[]> | undefined
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a')
      })
    )
    scope.own('async-reentrant', {
      force: async () => {
        await Promise.resolve()
        calls.push('async-reentrant')
        joined = scope.dispose()
      }
    })
    const first = scope.dispose()
    const errors = await first
    expect(calls).toEqual(['async-reentrant', 'a'])
    expect(errors).toEqual([])
    expect(joined).toBe(first)
  })

  it('own() from within a disposer is rejected the same way (shared admission mechanism)', async () => {
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own(
      'x',
      forceDescriptor(() => {
        scope.own(
          'late',
          forceDescriptor(() => {})
        )
      })
    )
    const errors = await scope.dispose()
    expect(errors).toHaveLength(1)
    expect((errors[0]!.error as { code: string }).code).toBe(LifecycleErrorCode.scopeReentrantOwn)
  })
})

describe('GC fallback', () => {
  it('explicit release() unregisters so the finalizer never runs afterward', async () => {
    if (typeof FinalizationRegistry === 'undefined') return // environment without GC hooks
    const force = vi.fn()
    const scope = createLifecycleScope()
    const resource = scope.own({}, { force, gcFallback: true })
    scope.release(resource)
    await scope.dispose()
    expect(force).not.toHaveBeenCalled()
  })

  it('normal dispose() also unregisters the GC fallback before releasing, so it never double-fires', async () => {
    if (typeof FinalizationRegistry === 'undefined') return
    let callCount = 0
    const scope = createLifecycleScope()
    scope.own(
      {},
      {
        force: () => {
          callCount++
        },
        gcFallback: true
      }
    )
    await scope.dispose()
    expect(callCount).toBe(1)
  })

  it('the held value passed to the registry does not reference the target resource directly', () => {
    if (typeof FinalizationRegistry === 'undefined') return
    const registerSpy = vi.spyOn(FinalizationRegistry.prototype, 'register')
    const scope = createLifecycleScope()
    const resource: Record<string, unknown> = {}
    scope.own(resource, { force: () => {}, gcFallback: true })
    expect(registerSpy).toHaveBeenCalled()
    const [target, heldValue] = registerSpy.mock.calls.at(-1)!
    expect(target).toBe(resource)
    expect(heldValue).not.toBe(resource)
    expect(typeof heldValue).toBe('object')
    registerSpy.mockRestore()
  })
})

describe('close() never calls user code', () => {
  it('close() does not invoke any disposer, graceful, force, or custom callback', () => {
    const force = vi.fn()
    const graceful = vi.fn()
    const custom = vi.fn()
    const scope = createLifecycleScope()
    scope.own('a', { force })
    scope.own('b', { graceful, force: vi.fn() })
    scope.own('c', { force: vi.fn(), custom })
    scope.close()
    expect(force).not.toHaveBeenCalled()
    expect(graceful).not.toHaveBeenCalled()
    expect(custom).not.toHaveBeenCalled()
  })

  it('close() only changes container state and is synchronous', () => {
    const scope = createLifecycleScope()
    expect(scope.lifecycle).toBe('open')
    const result = scope.close()
    expect(result).toBeUndefined()
    expect(scope.lifecycle).toBe('closing')
  })

  it('close() cascades: after close(), the scope no longer accepts new own()', () => {
    const scope = createLifecycleScope()
    scope.close()
    expect(() =>
      scope.own(
        'x',
        forceDescriptor(() => {})
      )
    ).toThrow()
  })
})

describe('dispose() implies close() first', () => {
  it('dispose() moves through closing before any user code runs, never open -> terminal directly', async () => {
    const observedStates: string[] = []
    const scope = createLifecycleScope()
    scope.own(
      'x',
      forceDescriptor(() => {
        observedStates.push(scope.lifecycle)
      })
    )
    expect(scope.lifecycle).toBe('open')
    const disposePromise = scope.dispose()
    // Synchronously after calling dispose(), close() has already run.
    expect(scope.lifecycle).toBe('closing')
    await disposePromise
    expect(observedStates).toEqual(['closing'])
    expect(scope.lifecycle).toBe('terminal')
  })
})

describe('dispose() promise identity', () => {
  it('concurrent, non-reentrant dispose() calls on an idle (empty) scope reuse the same promise', () => {
    // With nothing owned, the teardown loop never runs, so `currentlyReleasing` never becomes
    // true — this is the unambiguous case where two calls are provably not reentrant with respect
    // to any disposer, and both must observe the exact same promise.
    const scope = createLifecycleScope()
    const p1 = scope.dispose()
    const p2 = scope.dispose()
    expect(p1).toBe(p2)
  })

  it('a caller that only learns about an in-flight dispose() after it has fully settled reuses the resolved outcome', async () => {
    let callCount = 0
    const scope = createLifecycleScope()
    scope.own(
      'x',
      forceDescriptor(async () => {
        callCount++
        await Promise.resolve()
      })
    )
    const first = await scope.dispose()
    const second = await scope.dispose()
    expect(callCount).toBe(1)
    expect(first).toEqual([])
    expect(second).toEqual([])
  })

  it('user release code runs once when an external synchronous double dispose() joins', async () => {
    let callCount = 0
    const scope = createLifecycleScope()
    scope.own(
      'x',
      forceDescriptor(async () => {
        callCount++
        await Promise.resolve()
      })
    )
    const p1 = scope.dispose()
    const p2 = scope.dispose()
    expect(p2).toBe(p1)
    await p1
    expect(callCount).toBe(1)
  })

  it('external concurrent dispose() calls reuse the same promise outside an active disposer callback', async () => {
    const gate = deferred<void>()
    const scope = createLifecycleScope()
    scope.own('x', {
      force: async () => {
        await gate.promise
      }
    })

    const first = scope.dispose()
    await Promise.resolve()
    const second = scope.dispose()
    expect(second).toBe(first)

    gate.resolve()
    await first
  })

  it('dispose() after terminal resolves to an empty array', async () => {
    const scope = createLifecycleScope()
    await scope.dispose()
    const after = await scope.dispose()
    expect(after).toEqual([])
  })
})

describe('LifecycleScope: atomic splice-then-reverse teardown', () => {
  it('every registered resource is released exactly once, in LIFO order', async () => {
    const calls: string[] = []
    const scope = createLifecycleScope()
    for (const label of ['a', 'b', 'c', 'd']) {
      scope.own(
        label,
        forceDescriptor(() => {
          calls.push(label)
        })
      )
    }
    await scope.dispose()
    expect(calls).toEqual(['d', 'c', 'b', 'a'])
  })

  it('own() during the release loop (reentrant) does not corrupt the in-progress snapshot for other items', async () => {
    const calls: string[] = []
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a')
      })
    )
    scope.own(
      'mid',
      forceDescriptor(() => {
        calls.push('mid')
        try {
          scope.own(
            'late',
            forceDescriptor(() => {})
          )
        } catch {
          // rejected — expected, does not disturb the ongoing snapshot iteration
        }
      })
    )
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c')
      })
    )
    await scope.dispose()
    expect(calls).toEqual(['c', 'mid', 'a'])
  })
})

describe('(LifecycleScope aspect): failed release does not stop remaining resources', () => {
  it('a force() throw for one resource does not prevent the rest from releasing', async () => {
    const calls: string[] = []
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a')
      })
    )
    scope.own(
      'failing',
      forceDescriptor(() => {
        calls.push('failing')
        throw new Error('boom')
      })
    )
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c')
      })
    )
    const errors = await scope.dispose()
    expect(calls).toEqual(['c', 'failing', 'a'])
    expect(errors).toHaveLength(1)
  })
})

describe('dispose() calling close() has no effect and does not throw', () => {
  it('close() invoked from within a disposer during dispose() is a harmless no-op', async () => {
    const scope = createLifecycleScope()
    let closeThrew = false
    scope.own(
      'x',
      forceDescriptor(() => {
        try {
          scope.close()
        } catch {
          closeThrew = true
        }
      })
    )
    await scope.dispose()
    expect(closeThrew).toBe(false)
    expect(scope.lifecycle).toBe('terminal')
  })

  it('the original shutdown/dispose transaction continues normally after an internal close() call', async () => {
    const calls: string[] = []
    const scope = createLifecycleScope()
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a')
      })
    )
    scope.own(
      'closer',
      forceDescriptor(() => {
        scope.close()
        calls.push('closer')
      })
    )
    await scope.dispose()
    expect(calls).toEqual(['closer', 'a'])
  })
})

describe('own() inside a disposer throws immediately, rest still releases', () => {
  it('the own()-caller’s error is attributed to that disposer under collect policy', async () => {
    const calls: string[] = []
    const scope = createLifecycleScope({ errorPolicy: 'collect' })
    scope.own(
      'a',
      forceDescriptor(() => {
        calls.push('a')
      })
    )
    scope.own(
      'owner',
      forceDescriptor(() => {
        calls.push('owner')
        scope.own(
          'too-late',
          forceDescriptor(() => {})
        )
      })
    )
    scope.own(
      'c',
      forceDescriptor(() => {
        calls.push('c')
      })
    )
    const errors = await scope.dispose()
    expect(calls).toEqual(['c', 'owner', 'a'])
    expect(errors).toHaveLength(1)
    expect((errors[0]!.error as { code: string }).code).toBe(LifecycleErrorCode.scopeReentrantOwn)
  })
})
