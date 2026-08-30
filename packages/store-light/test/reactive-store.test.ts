import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import type { IDisposable } from '@migaia/reactive'
import type { IAbortSignal } from '@migaia/lifecycle'
import {
  createStore,
  createStoreSync,
  createAsyncStore,
  createLegacyStore,
  storeReady,
  raw,
  isRaw,
  isFieldBuilder,
  FIELD_BUILDER,
  type IFieldBuilder,
  type IFieldContext
} from '../src'

// Minimal sync IFieldBuilder used to exercise the IFieldBuilder protocol without
// pulling in a real implementation package (store-wasm). Mirrors the USEGUIDE
// counterField() example.
function counterField(initial: number): IFieldBuilder<IDisposable & { value: number }> {
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ createSource }: IFieldContext) {
      const source = createSource('CounterField')
      let value = initial
      let disposed = false
      return {
        get value() {
          source.track()
          return value
        },
        set value(v: number) {
          source.commit(() => {
            value = v
          })
        },
        get disposed() {
          return disposed
        },
        dispose() {
          if (disposed) return
          disposed = true
          source.dispose()
        }
      }
    }
  }
}

describe('$hydrate input boundary', () => {
  it('contains hostile patch and hydration getters before mutation', () => {
    const store = createStore({ count: 1 })
    const { proxy, revoke } = Proxy.revocable({ count: 2 }, {})
    revoke()
    expect(() => store.$set(proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-light',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    expect(() => store.$hydrate(proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-light',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    expect(store.$plain()).toEqual({ count: 1 })
    const optionsProxy = Proxy.revocable({}, {})
    optionsProxy.revoke()
    expect(() => store.$hydrate({ count: 2 }, optionsProxy.proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-light',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    expect(store.$plain()).toEqual({ count: 1 })
    store.$dispose()
  })
  it('rejects null options with a tagged configuration error', () => {
    const store = createStore({ count: 1 })
    expect(() => store.$hydrate({}, null as never)).toThrow(
      '[store] store options must be an object'
    )
    store.$dispose()
  })

  it('rejects null patches, partials, recipes, and listeners at the API boundary', () => {
    const store = createStore({ count: 1 })
    expect(() => store.$set(null as never)).toThrow('[store] $set patch must be an object')
    expect(() => store.$hydrate(null as never)).toThrow(
      '[store] $hydrate partial must be an object'
    )
    expect(() => store.$batch(null as never)).toThrow('[store] $batch recipe must be a function')
    expect(() => store.$subscribe(null as never)).toThrow(
      '[store] $subscribe listener must be a function'
    )
    store.$dispose()
  })
})

// Async IFieldBuilder: resolves after a microtask, optionally rejecting, so tests can
// exercise createAsyncStore()/createLegacyStore()/storeReady() and init-failure cleanup.
function asyncCounterField(
  initial: number,
  opts?: { fail?: boolean; onCreate?: (signal: IAbortSignal) => void }
): IFieldBuilder<IDisposable & { value: number }> {
  return {
    [FIELD_BUILDER]: true,
    mode: 'async',
    async create({ createSource, signal }: IFieldContext) {
      opts?.onCreate?.(signal)
      await Promise.resolve()
      if (opts?.fail) throw new Error('async field init failed')
      // A well-behaved cancellable builder checks the abort signal before doing any
      // further work with the (possibly already-disposed-scope) createSource capability.
      if (signal.aborted) throw new Error('[test] aborted')
      const source = createSource('AsyncCounterField')
      let value = initial
      let disposed = false
      return {
        get value() {
          source.track()
          return value
        },
        set value(v: number) {
          source.commit(() => {
            value = v
          })
        },
        get disposed() {
          return disposed
        },
        dispose() {
          if (disposed) return
          disposed = true
          source.dispose()
        }
      }
    }
  }
}

describe('createStore: field classification', () => {
  it('contains hostile definition proxies as tagged construction errors', () => {
    const { proxy, revoke } = Proxy.revocable({ count: 1 }, {})
    revoke()
    try {
      createStore(proxy as never)
      throw new Error('expected store construction to fail')
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-light',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    }
  })

  it('contains revoked store options proxies as tagged configuration errors', () => {
    const { proxy, revoke } = Proxy.revocable({ debugName: 'hostile' }, {})
    revoke()
    try {
      createStore({ count: 1 }, proxy as never)
      throw new Error('expected store options to fail')
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-light',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    }
  })

  it('rejects invalid debug and mutation policy option shapes before field setup', () => {
    expect(() => createStore({ count: 1 }, { debugName: Symbol('name') as never })).toThrow(
      '[store] store options have an invalid field shape'
    )
    expect(() =>
      createStore({ count: 1 }, { mutationPolicy: { assertMutationAllowed: 1 } as never })
    ).toThrow('[store] store options have an invalid field shape')
  })
  it('treats plain values as signals: readable, writable, subscribable', () => {
    const runtime = createRuntime()
    const store = createStore({ count: 1 }, { runtime })
    expect(store.count).toBe(1)
    store.count = 5
    expect(store.count).toBe(5)
    store.$dispose()
  })

  it('treats get accessors as lazily-cached computed values that recompute only on dependency change', () => {
    const runtime = createRuntime()
    let evaluations = 0
    const store = createStore(
      {
        count: 2,
        get doubled() {
          evaluations++
          return this.count * 2
        }
      },
      { runtime }
    )
    expect(store.doubled).toBe(4)
    expect(store.doubled).toBe(4) // repeated read without dependency change: no recompute
    expect(evaluations).toBe(1)
    store.count = 3
    expect(store.doubled).toBe(6)
    expect(evaluations).toBe(2)
    store.$dispose()
  })

  it('rejects writes to computed fields (getter-only property)', () => {
    'use strict'
    const runtime = createRuntime()
    const store = createStore(
      {
        count: 1,
        get doubled() {
          return this.count * 2
        }
      },
      { runtime }
    )
    expect(() => {
      store.doubled = 10
    }).toThrow(TypeError)
    store.$dispose()
  })

  it('treats plain methods as actions: batched, untracked, this-bound to the store', () => {
    const runtime = createRuntime()
    let notifications = 0
    const store = createStore(
      {
        a: 1,
        b: 1,
        bump() {
          this.a += 1
          this.b += 1
        }
      },
      { runtime }
    )
    store.$subscribe(() => notifications++)
    store.bump()
    expect(store.a).toBe(2)
    expect(store.b).toBe(2)
    // Two field writes inside one action must coalesce into a single notification.
    expect(notifications).toBe(1)
    store.$dispose()
  })

  it('passes action arguments through and returns the action result', () => {
    const runtime = createRuntime()
    const store = createStore(
      {
        total: 0,
        add(n: number, extra: number) {
          this.total += n + extra
          return this.total
        }
      },
      { runtime }
    )
    expect(store.add(2, 3)).toBe(5)
    store.$dispose()
  })

  it('raw() stores a function value as data instead of wrapping it as an action', () => {
    const runtime = createRuntime()
    const handler = vi.fn((x: number) => x + 1)
    const store = createStore(
      {
        onSubmit: raw(handler)
      },
      { runtime }
    )
    // Calling the field directly invokes the original function (not an action wrapper).
    const result = store.onSubmit(41)
    expect(result).toBe(42)
    expect(handler).toHaveBeenCalledWith(41)

    const replacement = vi.fn((x: number) => x + 100)
    store.onSubmit = replacement
    expect(store.onSubmit(1)).toBe(101)
    store.$dispose()
  })

  it('isRaw()/raw() round-trip and only recognize genuine IRaw wrappers', () => {
    const wrapped = raw(() => 1)
    expect(isRaw(wrapped)).toBe(true)
    expect(isRaw(() => 1)).toBe(false)
    expect(isRaw({ value: 1 })).toBe(false)
    expect(isRaw(null)).toBe(false)
  })
})

describe('createStore: IFieldBuilder protocol', () => {
  it('adopts a sync IFieldBuilder field, exposes its instance, and disposes it on $dispose', () => {
    const runtime = createRuntime()
    const store = createStore({ price: counterField(10) }, { runtime })
    const field = store.price
    expect(field.value).toBe(10)
    field.value = 20
    expect(field.value).toBe(20)
    expect(field.disposed).toBe(false)
    store.$dispose()
    expect(field.disposed).toBe(true)
  })

  it('isFieldBuilder() identifies FIELD_BUILDER-branded objects only', () => {
    expect(isFieldBuilder(counterField(1))).toBe(true)
    expect(isFieldBuilder({ mode: 'sync', create: () => {} })).toBe(false)
    expect(isFieldBuilder(null)).toBe(false)
    expect(isFieldBuilder(42)).toBe(false)
  })

  it('createStore() rejects a non-sync IFieldBuilder field before any I/O, naming the offending key', () => {
    const runtime = createRuntime()
    expect(() => createStore({ profile: asyncCounterField(1) }, { runtime })).toThrowError(
      '[store] createStore() only accepts synchronous fields; "profile" is a IFieldBuilder. Use createAsyncStore().'
    )
  })

  it('createStoreSync is a direct alias of createStore', () => {
    expect(createStoreSync).toBe(createStore)
  })
})

describe('createAsyncStore / createLegacyStore / storeReady', () => {
  it('contains cleanup reporter failure after synchronous construction failure', async () => {
    const cleanup = new Error('sync cleanup failed')
    let reporterCalled = false
    const reporter = () => {
      reporterCalled = true
      throw new Error('runtime reporter failed')
    }
    const runtime = createRuntime()
    vi.spyOn(runtime, 'reportError').mockImplementation(reporter)
    const dirty: IFieldBuilder<IDisposable & { value: number }> = {
      [FIELD_BUILDER]: true,
      mode: 'sync',
      create: () => ({
        value: 1,
        disposed: false,
        dispose: () => {
          throw cleanup
        }
      })
    }
    expect(() =>
      createLegacyStore(
        {
          dirty,
          bad: {
            [FIELD_BUILDER]: true,
            mode: 'sync',
            create: () => {
              throw new Error('sync init failed')
            }
          } as IFieldBuilder<IDisposable & { value: number }>
        },
        { runtime }
      )
    ).toThrow('sync init failed')

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(reporterCalled).toBe(true)
  })

  it('disposes an async field that resolves after a synchronous sibling failure', async () => {
    let disposed = false
    const late: IFieldBuilder<IDisposable & { value: number }> = {
      [FIELD_BUILDER]: true,
      mode: 'async',
      create: async () => {
        await Promise.resolve()
        return { value: 1, disposed: false, dispose: () => void (disposed = true) }
      }
    }
    const bad: IFieldBuilder<IDisposable & { value: number }> = {
      [FIELD_BUILDER]: true,
      mode: 'sync',
      create: () => {
        throw new Error('sync field failed')
      }
    }
    expect(() => createLegacyStore({ late, bad })).toThrow('sync field failed')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(disposed).toBe(true)
  })

  it('createAsyncStore resolves only after every async field has initialized', async () => {
    const runtime = createRuntime()
    const store = await createAsyncStore({ price: asyncCounterField(7) }, { runtime })
    expect(store.$async).toBe(true)
    expect(store.price.value).toBe(7)
    store.$dispose()
  })

  it('createLegacyStore returns synchronously with async fields still pending; access throws until storeReady() resolves', async () => {
    const runtime = createRuntime()
    const store = createLegacyStore({ price: asyncCounterField(3) }, { runtime })
    expect(() => store.price).toThrow(
      '[store] store is pending; use createAsyncStore() before accessing async fields'
    )
    await storeReady(store)
    expect(store.price.value).toBe(3)
    store.$dispose()
  })

  it('storeReady() throws a descriptive error for objects with no async initialization', () => {
    expect(() => storeReady({})).toThrow('[store] store has no asynchronous initialization')
  })

  it('async field initialization failure disposes the store and rejects storeReady()/createAsyncStore()', async () => {
    const runtime = createRuntime()
    const store = createLegacyStore({ price: asyncCounterField(1, { fail: true }) }, { runtime })
    await expect(storeReady(store)).rejects.toThrow('async field init failed')
    expect(store.$disposed).toBe(true)
    expect(() => store.price).toThrow('[store] store is disposed')

    await expect(
      createAsyncStore({ price: asyncCounterField(1, { fail: true }) }, { runtime })
    ).rejects.toThrow('async field init failed')
  })

  it('$dispose() before async initialization completes aborts the IFieldBuilder signal and disposes the resolved field instead of leaking it', async () => {
    const runtime = createRuntime()
    let capturedSignal: IAbortSignal | undefined
    const store = createLegacyStore(
      {
        price: asyncCounterField(1, {
          onCreate: (signal) => {
            capturedSignal = signal
          }
        })
      },
      { runtime }
    )
    store.$dispose()
    await Promise.resolve()
    expect(capturedSignal?.aborted).toBe(true)
    // Awaiting readiness after dispose must not throw synchronously nor hang; the store
    // stays disposed regardless of how the in-flight async field settles.
    await storeReady(store).catch(() => undefined)
    expect(store.$disposed).toBe(true)
  })
})

describe('$dispose(): unified disposed semantics', () => {
  it('is idempotent: a second $dispose() call is a no-op', () => {
    const runtime = createRuntime()
    const store = createStore({ count: 1 }, { runtime })
    store.$dispose()
    expect(() => store.$dispose()).not.toThrow()
    expect(store.$disposed).toBe(true)
  })

  it('rejects every read/write/action/$-API call uniformly after dispose (no half-dead state)', () => {
    const runtime = createRuntime()
    const store = createStore(
      {
        count: 1,
        get doubled() {
          return this.count * 2
        },
        bump() {
          this.count += 1
        }
      },
      { runtime }
    )
    store.$dispose()
    const disposedError = '[store] store is disposed'
    expect(() => store.count).toThrow(disposedError)
    expect(() => (store.count = 2)).toThrow(disposedError)
    expect(() => store.doubled).toThrow(disposedError)
    expect(() => store.bump()).toThrow(disposedError)
    expect(() => store.$snapshot()).toThrow(disposedError)
    expect(() => store.$subscribe(() => {})).toThrow(disposedError)
    expect(() => store.$batch(() => {})).toThrow(disposedError)
    expect(() => store.$set({ count: 1 })).toThrow(disposedError)
    expect(() => store.$plain()).toThrow(disposedError)
    expect(() => store.$hydrate({ count: 1 })).toThrow(disposedError)
  })
})

describe('$snapshot / $plain / $hydrate / $set', () => {
  it('$snapshot returns signals and computed fields but not $-prefixed API members', () => {
    const runtime = createRuntime()
    const store = createStore(
      {
        count: 3,
        get doubled() {
          return this.count * 2
        }
      },
      { runtime }
    )
    const snap = store.$snapshot()
    expect(snap).toEqual({ count: 3, doubled: 6 })
    expect(Object.keys(snap)).not.toContain('$dispose')
    store.$dispose()
  })

  it('$-API members are non-enumerable on the store itself', () => {
    const runtime = createRuntime()
    const store = createStore({ count: 1 }, { runtime })
    expect(Object.keys(store)).toEqual(['count'])
    store.$dispose()
  })

  it('$plain returns only signal-backed fields, excluding computed and methods', () => {
    const runtime = createRuntime()
    const store = createStore(
      {
        count: 3,
        label: 'x',
        get doubled() {
          return this.count * 2
        },
        bump() {
          this.count += 1
        }
      },
      { runtime }
    )
    expect(store.$plain()).toEqual({ count: 3, label: 'x' })
    store.$dispose()
  })

  it('$plain does not require the store to be ready (works while async fields are pending)', () => {
    const runtime = createRuntime()
    const store = createLegacyStore({ count: 3, price: asyncCounterField(1) }, { runtime })
    expect(store.$plain()).toEqual({ count: 3 })
    store.$dispose()
  })

  it('$hydrate default (unknown: "ignore") silently skips unrecognized keys and writes known signal keys in one transaction', () => {
    const runtime = createRuntime()
    let notifications = 0
    const store = createStore({ a: 1, b: 2 }, { runtime })
    store.$subscribe(() => notifications++)
    store.$hydrate({ a: 10, ghost: 99 })
    expect(store.a).toBe(10)
    expect(store.b).toBe(2)
    expect(notifications).toBe(1)
    store.$dispose()
  })

  it('$hydrate({ unknown: "strict" }) throws naming the first unknown key', () => {
    const runtime = createRuntime()
    const store = createStore({ a: 1 }, { runtime })
    expect(() => store.$hydrate({ a: 2, ghost: 1 }, { unknown: 'strict' })).toThrow(
      '[store] unknown hydration field: ghost'
    )
    store.$dispose()
  })

  it('$hydrate({ unknown: "report" }) calls onUnknown for each unrecognized key but still writes known keys', () => {
    const runtime = createRuntime()
    const store = createStore({ a: 1 }, { runtime })
    const seen: string[] = []
    store.$hydrate(
      { a: 5, ghost1: 1, ghost2: 2 },
      { unknown: 'report', onUnknown: (key) => seen.push(key) }
    )
    expect(store.a).toBe(5)
    expect(seen.sort()).toEqual(['ghost1', 'ghost2'])
    store.$dispose()
  })

  it('$hydrate silently skips computed/method keys even without unknown handling (they are not signals)', () => {
    const runtime = createRuntime()
    const store = createStore(
      {
        a: 1,
        get doubled() {
          return this.a * 2
        }
      },
      { runtime }
    )
    // "doubled" is not a signal key, so it is treated like any other unknown key.
    expect(() => store.$hydrate({ doubled: 999 })).not.toThrow()
    expect(store.doubled).toBe(2)
    store.$dispose()
  })

  it('$set writes multiple signal fields atomically (single notification)', () => {
    const runtime = createRuntime()
    let notifications = 0
    const store = createStore({ a: 1, b: 1 }, { runtime })
    store.$subscribe(() => notifications++)
    store.$set({ a: 10, b: 20 })
    expect(store.a).toBe(10)
    expect(store.b).toBe(20)
    expect(notifications).toBe(1)
    store.$dispose()
  })

  it('$set throws for a key that does not correspond to any signal (defensive runtime check)', () => {
    const runtime = createRuntime()
    const store = createStore({ a: 1 }, { runtime })
    expect(() =>
      // @ts-expect-error intentionally passing an unknown key to exercise the runtime guard
      store.$set({ ghost: 1 })
    ).toThrow('[store] field is not settable: ghost')
    store.$dispose()
  })
})

describe('$batch', () => {
  it('coalesces multiple writes performed in the recipe into a single notification', () => {
    const runtime = createRuntime()
    let notifications = 0
    const store = createStore({ a: 1, b: 1 }, { runtime })
    store.$subscribe(() => notifications++)
    store.$batch((draft) => {
      draft.a = 2
      draft.b = 3
    })
    expect(store.a).toBe(2)
    expect(store.b).toBe(3)
    expect(notifications).toBe(1)
    store.$dispose()
  })

  it('is not transactional: a write before a mid-recipe throw remains applied', () => {
    const runtime = createRuntime()
    const store = createStore({ a: 1, b: 1 }, { runtime })
    expect(() =>
      store.$batch((draft) => {
        draft.a = 999
        throw new Error('boom')
      })
    ).toThrow('boom')
    // The write before the throw is NOT rolled back — documented $batch semantics.
    expect(store.a).toBe(999)
    store.$dispose()
  })
})

describe('$subscribe', () => {
  it('fires on relevant signal changes but not for reads with no change', async () => {
    const runtime = createRuntime()
    const store = createStore({ a: 1 }, { runtime })
    const fn = vi.fn()
    store.$subscribe(fn)
    expect(fn).not.toHaveBeenCalled()
    store.a = 2
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)
    store.$dispose()
  })

  it('fireImmediately: true invokes the listener once upon subscription', () => {
    const runtime = createRuntime()
    const store = createStore({ a: 1 }, { runtime })
    const fn = vi.fn()
    store.$subscribe(fn, { fireImmediately: true })
    expect(fn).toHaveBeenCalledTimes(1)
    store.$dispose()
  })

  it('unsubscribing stops further notifications', async () => {
    const runtime = createRuntime()
    const store = createStore({ a: 1 }, { runtime })
    const fn = vi.fn()
    const unsubscribe = store.$subscribe(fn)
    store.a = 2
    await Promise.resolve()
    expect(fn).toHaveBeenCalledTimes(1)
    unsubscribe()
    store.a = 3
    expect(fn).toHaveBeenCalledTimes(1)
    store.$dispose()
  })

  it('reports a listener error via runtime.reportError instead of throwing out of the write that triggered it', async () => {
    const onError = vi.fn()
    const runtime = createRuntime({ onError })
    const store = createStore({ a: 1 }, { runtime })
    store.$subscribe(() => {
      throw new Error('listener boom')
    })
    expect(() => {
      store.a = 2
    }).not.toThrow()
    await Promise.resolve()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
    store.$dispose()
  })

  it('contains a throwing runtime reporter and keeps the subscription alive', async () => {
    const runtime = createRuntime()
    const reporterFailure = new Error('runtime reporter failed')
    const hostReportError = vi.fn()
    vi.spyOn(runtime, 'reportError').mockImplementation(() => {
      throw reporterFailure
    })
    vi.stubGlobal('reportError', hostReportError)
    try {
      const store = createStore({ a: 1 }, { runtime })
      let calls = 0
      store.$subscribe(() => {
        calls++
        throw new Error('listener boom')
      })

      expect(() => {
        store.a = 2
      }).not.toThrow()
      await Promise.resolve()
      expect(() => {
        store.a = 3
      }).not.toThrow()
      await Promise.resolve()
      expect(calls).toBe(2)
      expect(hostReportError).not.toHaveBeenCalled()
      store.$dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('$dispose lifecycle', () => {
  it('is single-flight while asynchronous owned cleanup is still pending', async () => {
    const store = createStore({ count: 1 })
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const resource = {
      disposed: false,
      dispose: () => pending
    } as unknown as IDisposable
    store.$own(resource)

    const first = store.$dispose()
    const second = store.$dispose()
    expect(second).toBe(first)

    let settled = false
    void second.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    release()
    await first
    expect(store.$dispose()).toBe(first)
  })
})

describe('mutationPolicy', () => {
  function makeStrictPolicy() {
    let depth = 0
    return {
      assertMutationAllowed(operation?: string) {
        if (depth === 0)
          throw new Error(`[store] set(${operation}) is not allowed outside an action`)
      },
      runInAction<T>(fn: () => T): T {
        depth++
        try {
          return fn()
        } finally {
          depth--
        }
      }
    }
  }

  it('blocks direct field writes outside of an action when a mutationPolicy is supplied', () => {
    const runtime = createRuntime()
    const store = createStore(
      {
        count: 1,
        increment() {
          this.count += 1
        }
      },
      { runtime, mutationPolicy: makeStrictPolicy() }
    )
    expect(() => {
      store.count = 5
    }).toThrow(/not allowed outside an action/)
    store.$dispose()
  })

  it('allows writes performed inside an action / $batch / $set / $hydrate', () => {
    const runtime = createRuntime()
    const store = createStore(
      {
        count: 1,
        increment() {
          this.count += 1
        }
      },
      { runtime, mutationPolicy: makeStrictPolicy() }
    )
    expect(() => store.increment()).not.toThrow()
    expect(store.count).toBe(2)
    expect(() => store.$batch((draft) => (draft.count = 10))).not.toThrow()
    expect(() => store.$set({ count: 20 })).not.toThrow()
    expect(() => store.$hydrate({ count: 30 })).not.toThrow()
    expect(store.count).toBe(30)
    store.$dispose()
  })

  it('does not affect stores created without a mutationPolicy (default: unrestricted)', () => {
    const runtime = createRuntime()
    const store = createStore({ count: 1 }, { runtime })
    expect(() => {
      store.count = 5
    }).not.toThrow()
    store.$dispose()
  })
})

describe('$own', () => {
  function fakeDisposable(): IDisposable & { disposeCalls: number } {
    let disposed = false
    return {
      disposeCalls: 0,
      get disposed() {
        return disposed
      },
      dispose(this: IDisposable & { disposeCalls: number }) {
        disposed = true
        this.disposeCalls++
      }
    }
  }

  it('adopts an external resource so $dispose() releases it too', async () => {
    const runtime = createRuntime()
    const store = createStore({ count: 1 }, { runtime })
    const owned = fakeDisposable()
    store.$own(owned)
    expect(owned.disposed).toBe(false)
    await store.$dispose()
    expect(owned.disposed).toBe(true)
  })

  it('accepts an unclaimed resource and releases it with the store', () => {
    const runtimeA = createRuntime()
    const store = createStore({ count: 1 }, { runtime: runtimeA })
    const owned = fakeDisposable()
    expect(() => store.$own(owned)).not.toThrow()
    store.$dispose()
    expect(owned.disposed).toBe(true)
  })
})

describe('debugName / $runtime / $async on plain stores', () => {
  it('exposes the configured runtime via $runtime', () => {
    const runtime = createRuntime()
    const store = createStore({ count: 1 }, { runtime })
    expect(store.$runtime).toBe(runtime)
    store.$dispose()
  })

  it('$async is false for stores with no async fields', () => {
    const runtime = createRuntime()
    const store = createStore({ count: 1 }, { runtime })
    expect(store.$async).toBe(false)
    store.$dispose()
  })
})
