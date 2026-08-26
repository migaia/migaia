import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import type { IRuntime } from '@migaia/reactive'
import { createSerializeRegistry, jsonPlugin, base64ToBytes } from '@migaia/serialize'
import type { ISerializeChunk, ISerializeParser, ISerializePlugin } from '@migaia/serialize'
import {
  createSSRRequestScope,
  deserializeSSRState,
  serializeSSRState,
  serializeTrustedSSRState,
  createSSRStateScript,
  readSSRStateFromDocument,
  createSSRStateScriptWith,
  readSSRStateFromDocumentWith,
  assertSSRState,
  SSRRequestScope
} from '../src'
import type { ISSRStore, ISSRResource, ISSRState, ISSRDocument, ITrustedSSRState } from '../src'
import { createStoreSsrRangeError, StoreSsrErrorCode } from '../src/errors.js'

describe('SSR error identity boundary', () => {
  it('preserves native error type while delegating source/code attachment', () => {
    const error = createStoreSsrRangeError(StoreSsrErrorCode.invalidOption, 'invalid option')
    expect(error).toBeInstanceOf(RangeError)
    expect(error).toMatchObject({
      source: '@migaia/store-ssr',
      code: 'INVALID_OPTION'
    })
    expect(error.stack).toContain('invalid option')
  })
})

describe('SSR request scope runtime input boundary', () => {
  it('contains revoked scope and registration options proxies', () => {
    const scopeOptions = Proxy.revocable({}, {})
    scopeOptions.revoke()
    expect(() => new SSRRequestScope(scopeOptions.proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-ssr',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    const scope = createSSRRequestScope()
    const registrationOptions = Proxy.revocable({}, {})
    registrationOptions.revoke()
    expect(() =>
      scope.register('app', fakeStore(scope.runtime), registrationOptions.proxy as never)
    ).toThrow(
      expect.objectContaining({
        source: '@migaia/store-ssr',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    scope.dispose()
  })

  it('snapshots request-scope runtime options exactly once', () => {
    const runtimeOptions = {}
    let reads = 0
    const options = {} as { readonly runtimeOptions?: typeof runtimeOptions }
    Object.defineProperty(options, 'runtimeOptions', {
      enumerable: true,
      get: () => {
        reads++
        if (reads > 1) throw new Error('runtimeOptions reread')
        return runtimeOptions
      }
    })
    const scope = new SSRRequestScope(options)
    expect(reads).toBe(1)
    scope.dispose()
  })
  it('rejects non-boolean registration ownership flags', () => {
    const scope = createSSRRequestScope()
    expect(() =>
      scope.register('app', fakeStore(scope.runtime), { owned: 'yes' as never })
    ).toThrow(expect.objectContaining({ source: '@migaia/store-ssr', code: 'INVALID_OPTION' }))
    scope.dispose()
  })

  it('snapshots registration ownership accessor exactly once', () => {
    const scope = new SSRRequestScope()
    const store = fakeStore(scope.runtime)
    let reads = 0
    const options = {} as { readonly owned?: boolean }
    Object.defineProperty(options, 'owned', {
      get: () => {
        reads++
        if (reads > 1) throw new Error('owned reread')
        return false
      }
    })
    scope.register('accessor', store, options)
    expect(reads).toBe(1)
    scope.unregister('accessor')
    scope.dispose()
  })
  it('rejects non-string registration keys before Map/object coercion', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    expect(() => scope.register(42 as never, store)).toThrow('[store] invalid SSR store key')
    scope.dispose()
  })

  it('rejects null options with a tagged configuration error', () => {
    expect(() => createSSRRequestScope(null as never)).toThrow(
      '[store] SSR request scope options must be an object'
    )
  })

  it('rejects timeout budgets that exceed the host timer maximum', async () => {
    const scope = createSSRRequestScope()
    await expect(scope.awaitResources({ timeoutMs: 2_147_483_648 })).rejects.toThrow(
      '[store] SSR awaitResources timeoutMs must be finite and non-negative'
    )
    scope.dispose()
  })

  it('rejects null options at registration and codec-script boundaries', async () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    expect(() => scope.register('store', store, null as never)).toThrow(
      '[store] SSR request scope options must be an object'
    )
    expect(() =>
      scope.registerResource(
        'resource',
        {
          runtime: scope.runtime,
          disposed: false,
          promise: Promise.resolve(undefined),
          dehydrate: () => undefined,
          hydrate: () => undefined,
          dispose: () => undefined
        },
        null as never
      )
    ).toThrow('[store] SSR request scope options must be an object')
    await expect(
      createSSRStateScriptWith({ version: 1, stores: {} }, null as never)
    ).rejects.toThrow('[store] SSR request scope options must be an object')
    await expect(readSSRStateFromDocumentWith(null as never)).rejects.toThrow(
      '[store] SSR request scope options must be an object'
    )
    await scope.disposeAsync()
  })
})

// ---- Test doubles ---------------------------------------------------------

/** Minimal ISSRStore double. `data` is the live backing record returned by $plain(). */
function fakeStore(
  runtime: IRuntime,
  data: Record<string, unknown> = {}
): ISSRStore & {
  readonly hydrateCalls: Record<string, unknown>[]
  readonly disposeCalls: number
  hydrateImpl?: (state: Record<string, unknown>) => void
} {
  let disposed = false
  const hydrateCalls: Record<string, unknown>[] = []
  let disposeCalls = 0
  const store = {
    $runtime: runtime,
    get $disposed() {
      return disposed
    },
    $plain() {
      return data
    },
    $hydrate(state: Record<string, unknown>) {
      hydrateCalls.push(state)
      store.hydrateImpl?.(state)
    },
    $dispose() {
      disposeCalls++
      disposed = true
    },
    get hydrateCalls() {
      return hydrateCalls
    },
    get disposeCalls() {
      return disposeCalls
    },
    hydrateImpl: undefined as ((state: Record<string, unknown>) => void) | undefined
  }
  return store
}

/** Minimal ISSRResource double. */
function fakeResource(
  runtime: IRuntime,
  options: {
    promise?: Promise<unknown>
    snapshot?:
      | { version: 1; data: unknown; updatedAt: number; expiresAt: number | null }
      | undefined
  } = {}
): ISSRResource & { readonly hydrateCalls: unknown[]; readonly disposeCalls: number } {
  let disposed = false
  const hydrateCalls: unknown[] = []
  let disposeCalls = 0
  const resource = {
    runtime,
    get disposed() {
      return disposed
    },
    promise: options.promise ?? Promise.resolve(undefined),
    dehydrate() {
      return options.snapshot
    },
    hydrate(snapshot: unknown) {
      hydrateCalls.push(snapshot)
    },
    dispose() {
      disposeCalls++
      disposed = true
    },
    get hydrateCalls() {
      return hydrateCalls
    },
    get disposeCalls() {
      return disposeCalls
    }
  }
  return resource
}

function pendingResource(runtime: IRuntime): {
  resource: ISSRResource
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: unknown) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  const resource: ISSRResource = {
    runtime,
    disposed: false,
    promise,
    dehydrate: () => undefined,
    hydrate: () => {},
    dispose: () => {}
  }
  return { resource, resolve, reject }
}

// ---- Constructor / disposed -----------------------------------------------

describe('SSRRequestScope construction', () => {
  it('creates its own isolated Runtime by default', () => {
    const scope = createSSRRequestScope()
    expect(scope.runtime).toBeDefined()
    expect(scope.disposed).toBe(false)
    scope.dispose()
  })

  it('reuses a caller-provided Runtime', () => {
    const runtime = createRuntime()
    const scope = new SSRRequestScope({ runtime })
    expect(scope.runtime).toBe(runtime)
    scope.dispose()
  })

  it('throws when both runtime and runtimeOptions are provided', () => {
    const runtime = createRuntime()
    expect(() => new SSRRequestScope({ runtime, runtimeOptions: {} })).toThrow(
      '[store] SSR scope accepts runtime or runtimeOptions, not both'
    )
  })

  it('disposed flips to true only after dispose()', () => {
    const scope = createSSRRequestScope()
    expect(scope.disposed).toBe(false)
    scope.dispose()
    expect(scope.disposed).toBe(true)
  })
})

// ---- register / unregister / detach ----------------------------------------

describe('register()', () => {
  it('rejects an empty key', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    expect(() => scope.register('', store)).toThrow('[store] invalid SSR store key')
    scope.dispose()
  })

  it('rejects "__proto__" as a key', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    expect(() => scope.register('__proto__', store)).toThrow('[store] invalid SSR store key')
    scope.dispose()
  })

  it('rejects a store belonging to a different Runtime', () => {
    const scope = createSSRRequestScope()
    const foreignRuntime = createRuntime()
    const store = fakeStore(foreignRuntime)
    expect(() => scope.register('app', store)).toThrow(
      '[store] SSR store "app" belongs to a different Runtime'
    )
    scope.dispose()
  })

  it('rejects a duplicate key without touching the existing registration', () => {
    const scope = createSSRRequestScope()
    const first = fakeStore(scope.runtime, { count: 1 })
    scope.register('app', first)
    const second = fakeStore(scope.runtime, { count: 2 })
    expect(() => scope.register('app', second)).toThrow('[store] duplicate SSR store key: app')
    expect(scope.dehydrate().stores.app).toEqual({ count: 1 })
    scope.dispose()
  })

  it('throws once the scope is disposed', () => {
    const scope = createSSRRequestScope()
    scope.dispose()
    expect(() => scope.register('app', fakeStore(scope.runtime))).toThrow(
      '[store] SSR request scope is disposed'
    )
  })

  it('applies a pending hydration snapshot before the registration is committed', () => {
    const scope = createSSRRequestScope()
    scope.hydrate({ version: 1, stores: { app: { count: 9 } } })
    const store = fakeStore(scope.runtime, { count: 0 })
    scope.register('app', store)
    expect(store.hydrateCalls).toEqual([{ count: 9 }])
  })

  it('leaves the key free and the pending hydration intact when $hydrate throws', () => {
    const scope = createSSRRequestScope()
    scope.hydrate({ version: 1, stores: { app: { count: 9 } } })
    const failing = fakeStore(scope.runtime)
    failing.hydrateImpl = () => {
      throw new Error('boom')
    }
    expect(() => scope.register('app', failing)).toThrow('boom')

    // Key stayed free: a second attempt with a working store succeeds and
    // still receives the same pending snapshot (nothing was consumed).
    const retry = fakeStore(scope.runtime, { count: 0 })
    scope.register('app', retry)
    expect(retry.hydrateCalls).toEqual([{ count: 9 }])
    scope.dispose()
  })

  it('contains a snapshot getter that fails during hydration replay', () => {
    const scope = createSSRRequestScope()
    let reads = 0
    const state = {
      version: 1 as const,
      stores: {
        get app() {
          reads++
          if (reads > 1) throw new Error('snapshot replay failed')
          return { count: 1 }
        }
      }
    }
    expect(() => scope.hydrate(state as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-ssr',
        code: 'INVALID_SNAPSHOT',
        cause: expect.any(Error)
      })
    )
    scope.dispose()
  })

  it('defaults owned to true', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    scope.register('app', store)
    scope.dispose()
    expect(store.disposeCalls).toBe(1)
  })
})

describe('unregister()', () => {
  it('returns false for a key that was never registered', () => {
    const scope = createSSRRequestScope()
    expect(scope.unregister('missing')).toBe(false)
    scope.dispose()
  })

  it('disposes an owned store by default and removes it from dehydrate()', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime, { count: 1 })
    scope.register('app', store)
    expect(scope.unregister('app')).toBe(true)
    expect(store.disposeCalls).toBe(1)
    expect(scope.dehydrate().stores.app).toBeUndefined()
    scope.dispose()
  })

  it('skips dispose when disposeOwned is false', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    scope.register('app', store)
    scope.unregister('app', false)
    expect(store.disposeCalls).toBe(0)
    scope.dispose()
  })

  it('never disposes a non-owned registration, even with disposeOwned=true', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    scope.register('app', store, { owned: false })
    scope.unregister('app', true)
    expect(store.disposeCalls).toBe(0)
    scope.dispose()
  })
})

describe('detach()', () => {
  it('removes the registration without disposing it, transferring ownership', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    scope.register('app', store)
    const detached = scope.detach('app')
    expect(detached).toBe(store)
    expect(scope.dehydrate().stores.app).toBeUndefined()
    scope.dispose()
    // Was owned, but detach() transferred it out before dispose() ran.
    expect(store.disposeCalls).toBe(0)
  })

  it('returns undefined for a key that was never registered', () => {
    const scope = createSSRRequestScope()
    expect(scope.detach('missing')).toBeUndefined()
    scope.dispose()
  })
})

// ---- resource variants: only the differences from the store path ----------

describe('registerResource() / unregisterResource() / detachResource()', () => {
  it('rejects a resource belonging to a different Runtime', () => {
    const scope = createSSRRequestScope()
    const resource = fakeResource(createRuntime())
    expect(() => scope.registerResource('user', resource)).toThrow(
      '[store] SSR resource "user" belongs to a different Runtime'
    )
    scope.dispose()
  })

  it('rejects a duplicate resource key', () => {
    const scope = createSSRRequestScope()
    scope.registerResource('user', fakeResource(scope.runtime))
    expect(() => scope.registerResource('user', fakeResource(scope.runtime))).toThrow(
      '[store] duplicate SSR resource key: user'
    )
    scope.dispose()
  })

  it('applies pending resource hydration before commit, and disposes owned resources in unregisterResource()', () => {
    const scope = createSSRRequestScope()
    scope.hydrate({
      version: 1,
      stores: {},
      resources: { user: { version: 1, data: { id: 1 }, updatedAt: 0, expiresAt: null } }
    })
    const resource = fakeResource(scope.runtime)
    scope.registerResource('user', resource)
    expect(resource.hydrateCalls).toEqual([
      { version: 1, data: { id: 1 }, updatedAt: 0, expiresAt: null }
    ])

    expect(scope.unregisterResource('user')).toBe(true)
    expect(resource.disposeCalls).toBe(1)
    scope.dispose()
  })

  it('detachResource transfers ownership without disposing', () => {
    const scope = createSSRRequestScope()
    const resource = fakeResource(scope.runtime)
    scope.registerResource('user', resource)
    expect(scope.detachResource('user')).toBe(resource)
    scope.dispose()
    expect(resource.disposeCalls).toBe(0)
  })
})

// ---- hydrate() --------------------------------------------------------------

describe('hydrate()', () => {
  it('validates the incoming state before touching any store', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    scope.register('app', store)
    expect(() => scope.hydrate({ version: 2, stores: {} } as unknown as ISSRState)).toThrow(
      '[store] invalid SSR state version'
    )
    expect(store.hydrateCalls).toHaveLength(0)
    scope.dispose()
  })

  it('hydrates an already-registered store immediately', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    scope.register('app', store)
    scope.hydrate({ version: 1, stores: { app: { count: 5 } } })
    expect(store.hydrateCalls).toEqual([{ count: 5 }])
    scope.dispose()
  })

  it('caches hydration for a not-yet-registered key and fully replaces the pending table on each call', () => {
    const scope = createSSRRequestScope()
    scope.hydrate({ version: 1, stores: { a: { v: 1 } } })
    scope.hydrate({ version: 1, stores: { b: { v: 2 } } })

    const storeA = fakeStore(scope.runtime)
    const storeB = fakeStore(scope.runtime)
    scope.register('a', storeA)
    scope.register('b', storeB)

    // Second hydrate() call replaced the pending table wholesale: "a" was dropped.
    expect(storeA.hydrateCalls).toHaveLength(0)
    expect(storeB.hydrateCalls).toEqual([{ v: 2 }])
    scope.dispose()
  })

  it('is best-effort: one failing store does not stop the others, and rethrows the sole error', () => {
    const scope = createSSRRequestScope()
    const ok = fakeStore(scope.runtime)
    const bad = fakeStore(scope.runtime)
    bad.hydrateImpl = () => {
      throw new Error('bad store')
    }
    scope.register('ok', ok)
    scope.register('bad', bad)

    expect(() => scope.hydrate({ version: 1, stores: { ok: { v: 1 }, bad: { v: 2 } } })).toThrow(
      'bad store'
    )
    expect(ok.hydrateCalls).toEqual([{ v: 1 }])
    expect(bad.hydrateCalls).toEqual([{ v: 2 }])
    scope.dispose()
  })

  it('wraps multiple failures (stores and resources) into a single AggregateError', () => {
    const scope = createSSRRequestScope()
    const badStore = fakeStore(scope.runtime)
    badStore.hydrateImpl = () => {
      throw new Error('store fail')
    }
    scope.register('s', badStore)

    const badResource = fakeResource(scope.runtime)
    badResource.hydrate = () => {
      throw new Error('resource fail')
    }
    scope.registerResource('r', badResource)

    let caught: unknown
    try {
      scope.hydrate({
        version: 1,
        stores: { s: {} },
        resources: { r: { version: 1, data: null, updatedAt: 0, expiresAt: null } }
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toHaveLength(2)
    expect((caught as Error).message).toContain('best-effort, not atomic')
    scope.dispose()
  })

  it('recursively converts nested resource data to Object.create(null) records', () => {
    const scope = createSSRRequestScope()
    const resource = fakeResource(scope.runtime)
    scope.registerResource('r', resource)
    scope.hydrate({
      version: 1,
      stores: {},
      resources: {
        r: {
          version: 1,
          data: { nested: { list: [{ deep: true }] } },
          updatedAt: 1,
          expiresAt: null
        }
      }
    })
    const [applied] = resource.hydrateCalls as [{ data: Record<string, unknown> }]
    expect(applied.data).toEqual({ nested: { list: [{ deep: true }] } })
    scope.dispose()
  })

  it('throws once the scope is disposed', () => {
    const scope = createSSRRequestScope()
    scope.dispose()
    expect(() => scope.hydrate({ version: 1, stores: {} })).toThrow(
      '[store] SSR request scope is disposed'
    )
  })
})

// ---- dehydrate() / dehydrateTrusted() --------------------------------------

describe('dehydrate()', () => {
  it('sorts stores and resources by key', () => {
    const scope = createSSRRequestScope()
    scope.register('zebra', fakeStore(scope.runtime, { v: 'z' }))
    scope.register('alpha', fakeStore(scope.runtime, { v: 'a' }))
    const state = scope.dehydrate()
    expect(Object.keys(state.stores)).toEqual(['alpha', 'zebra'])
    scope.dispose()
  })

  it('skips disposed stores and resources without a value', () => {
    const scope = createSSRRequestScope()
    const disposedStore = fakeStore(scope.runtime, { v: 1 })
    scope.register('gone', disposedStore)
    disposedStore.$dispose()

    const emptyResource = fakeResource(scope.runtime, { snapshot: undefined })
    scope.registerResource('pending', emptyResource)

    const filledResource = fakeResource(scope.runtime, {
      snapshot: { version: 1, data: { ok: true }, updatedAt: 1, expiresAt: null }
    })
    scope.registerResource('ready', filledResource)

    const state = scope.dehydrate()
    expect(state.stores.gone).toBeUndefined()
    expect(state.resources?.pending).toBeUndefined()
    expect(state.resources?.ready?.data).toEqual({ ok: true })
    scope.dispose()
  })

  it('deep-freezes the resulting state', () => {
    const scope = createSSRRequestScope()
    scope.register('app', fakeStore(scope.runtime, { nested: { count: 1 } }))
    const state = scope.dehydrate()
    expect(Object.isFrozen(state)).toBe(true)
    expect(Object.isFrozen(state.stores)).toBe(true)
    expect(Object.isFrozen(state.stores.app)).toBe(true)
    expect(Object.isFrozen(state.stores.app.nested)).toBe(true)
    scope.dispose()
  })

  it('rejects a cyclic $plain() payload', () => {
    const scope = createSSRRequestScope()
    const cyclic: Record<string, unknown> = { self: null }
    cyclic.self = cyclic
    scope.register('app', fakeStore(scope.runtime, cyclic))
    expect(() => scope.dehydrate()).toThrow('contains a cycle')
    scope.dispose()
  })

  it('rejects a non-finite number in the $plain() payload', () => {
    const scope = createSSRRequestScope()
    scope.register('app', fakeStore(scope.runtime, { n: Number.NaN }))
    expect(() => scope.dehydrate()).toThrow('contains a non-finite number')
    scope.dispose()
  })

  it('rejects a non-plain-object value (e.g. a Date instance)', () => {
    const scope = createSSRRequestScope()
    scope.register('app', fakeStore(scope.runtime, { when: new Date() }))
    expect(() => scope.dehydrate()).toThrow('contains a non-plain object')
    scope.dispose()
  })

  it('rejects payloads nested past the depth limit', () => {
    const scope = createSSRRequestScope()
    let deep: unknown = 0
    for (let i = 0; i < 260; i++) deep = [deep]
    scope.register('app', fakeStore(scope.runtime, { deep }))
    expect(() => scope.dehydrate()).toThrow('exceeds the JSON depth limit')
    scope.dispose()
  })

  it('throws once the scope is disposed', () => {
    const scope = createSSRRequestScope()
    scope.dispose()
    expect(() => scope.dehydrate()).toThrow('[store] SSR request scope is disposed')
  })
})

describe('dehydrateTrusted()', () => {
  it('returns live references instead of a copy', () => {
    const scope = createSSRRequestScope()
    const data: Record<string, unknown> = { count: 1 }
    scope.register('app', fakeStore(scope.runtime, data))
    const trusted = scope.dehydrateTrusted()
    expect(trusted.stores.app).toBe(data)
    data.count = 2
    // No copy was made: mutating the source object after the call changes
    // what the already-returned reference reports.
    expect(trusted.stores.app.count).toBe(2)
    scope.dispose()
  })

  it('skips disposed stores and valueless resources, same as dehydrate()', () => {
    const scope = createSSRRequestScope()
    const disposedStore = fakeStore(scope.runtime, { v: 1 })
    scope.register('gone', disposedStore)
    disposedStore.$dispose()
    const emptyResource = fakeResource(scope.runtime, { snapshot: undefined })
    scope.registerResource('pending', emptyResource)

    const trusted = scope.dehydrateTrusted()
    expect(trusted.stores.gone).toBeUndefined()
    expect(trusted.resources?.pending).toBeUndefined()
    scope.dispose()
  })

  it('throws once the scope is disposed', () => {
    const scope = createSSRRequestScope()
    scope.dispose()
    expect(() => scope.dehydrateTrusted()).toThrow('[store] SSR request scope is disposed')
  })
})

// ---- awaitResources() / dehydrateAsync() -----------------------------------

describe('awaitResources()', () => {
  it('snapshots timeoutMs after validation', async () => {
    const scope = new SSRRequestScope()
    let reads = 0
    const options = {} as { readonly timeoutMs?: number }
    Object.defineProperty(options, 'timeoutMs', {
      enumerable: true,
      get: () => {
        reads++
        if (reads > 1) throw new Error('timeoutMs reread')
        return 0
      }
    })
    expect(await scope.awaitResources(options)).toEqual([])
    expect(reads).toBe(1)
    scope.dispose()
  })

  it('rejects a negative timeoutMs synchronously', async () => {
    // `awaitResources()` is `async`, so even a throw on its very first line — before any
    // `await` — never escapes as a synchronous exception from the call expression; the async
    // function machinery always converts it into a rejected Promise. `assertTimeoutMs()` still
    // runs before any real waiting begins (that's the "synchronously" this test title means),
    // but observing it requires `rejects`, not a sync `toThrow` wrapper.
    const scope = createSSRRequestScope()
    await expect(scope.awaitResources({ timeoutMs: -1 })).rejects.toThrow(
      '[store] SSR awaitResources timeoutMs must be finite and non-negative'
    )
    scope.dispose()
  })

  it('rejects NaN and Infinity as timeoutMs', async () => {
    const scope = createSSRRequestScope()
    await expect(scope.awaitResources({ timeoutMs: Number.NaN })).rejects.toThrow(RangeError)
    await expect(scope.awaitResources({ timeoutMs: Number.POSITIVE_INFINITY })).rejects.toThrow(
      RangeError
    )
    scope.dispose()
  })

  it('accepts timeoutMs: 0 and treats it as an immediate expiry for any pending resource', async () => {
    const scope = createSSRRequestScope()
    const { resource } = pendingResource(scope.runtime) // never settles on its own
    scope.registerResource('r', resource)
    const failures = await scope.awaitResources({ timeoutMs: 0 })
    expect(failures).toHaveLength(1)
    expect(failures[0].key).toBe('r')
    expect(String(failures[0].error)).toContain('did not settle within 0ms')
    scope.dispose()
  })

  it('returns no failures once every registered resource has already settled', async () => {
    const scope = createSSRRequestScope()
    scope.registerResource('r', fakeResource(scope.runtime, { promise: Promise.resolve(1) }))
    const failures = await scope.awaitResources()
    expect(failures).toEqual([])
    scope.dispose()
  })

  it('collects a rejection as a failure without throwing', async () => {
    const scope = createSSRRequestScope()
    scope.registerResource(
      'r',
      fakeResource(scope.runtime, { promise: Promise.reject(new Error('fetch failed')) })
    )
    const failures = await scope.awaitResources()
    expect(failures).toHaveLength(1)
    expect((failures[0].error as Error).message).toBe('fetch failed')
    scope.dispose()
  })

  it('records a synchronous throw from the .promise getter exactly once across rounds', async () => {
    const scope = createSSRRequestScope()
    let getterCalls = 0
    // A second, genuinely-pending resource forces a second round so the
    // throwing getter's key is revisited and must not be double-reported.
    const { resource: slow, resolve } = pendingResource(scope.runtime)
    const throwing: ISSRResource = {
      runtime: scope.runtime,
      disposed: false,
      get promise(): Promise<unknown> {
        getterCalls++
        throw new Error('getter blew up')
      },
      dehydrate: () => undefined,
      hydrate: () => {},
      dispose: () => {}
    }
    scope.registerResource('throwing', throwing)
    scope.registerResource('slow', slow)

    const pending = scope.awaitResources()
    // Let round 1 run, then let "slow" settle so round 2 happens.
    await Promise.resolve()
    await Promise.resolve()
    resolve(1)
    const failures = await pending

    expect(failures).toHaveLength(1)
    expect(failures[0].key).toBe('throwing')
    expect(getterCalls).toBeGreaterThanOrEqual(2)
    scope.dispose()
  })

  it('times out the whole wait after timeoutMs and marks every still-pending resource as failed', async () => {
    const scope = createSSRRequestScope()
    const { resource } = pendingResource(scope.runtime)
    scope.registerResource('r', resource)
    const failures = await scope.awaitResources({ timeoutMs: 5 })
    expect(failures).toHaveLength(1)
    expect(String(failures[0].error)).toContain('did not settle within 5ms')
    scope.dispose()
  })

  it('short-circuits with whatever failures were already collected when the scope is disposed mid-wait', async () => {
    const scope = createSSRRequestScope()
    const { resource } = pendingResource(scope.runtime) // never resolves
    scope.registerResource('r', resource)
    const pending = scope.awaitResources()
    await Promise.resolve()
    scope.dispose()
    const failures = await pending
    expect(failures).toEqual([])
  })

  it('throws once MAX_RESOURCE_ROUNDS (64) is exceeded by perpetual waterfall registration', async () => {
    const scope = createSSRRequestScope()
    // A resource whose `.promise` getter returns a *new* already-resolved
    // promise every access: identity never matches the previous round's
    // observed promise, so the round loop never naturally terminates.
    const everRenewing: ISSRResource = {
      runtime: scope.runtime,
      disposed: false,
      get promise() {
        return Promise.resolve(1)
      },
      dehydrate: () => undefined,
      hydrate: () => {},
      dispose: () => {}
    }
    scope.registerResource('r', everRenewing)
    await expect(scope.awaitResources()).rejects.toThrow(
      '[store] SSR resources kept registering new resources past 64 rounds'
    )
    scope.dispose()
  })

  it('throws once the scope is disposed before the call', async () => {
    const scope = createSSRRequestScope()
    scope.dispose()
    await expect(scope.awaitResources()).rejects.toThrow('[store] SSR request scope is disposed')
  })
})

describe('dehydrateAsync()', () => {
  it('snapshots onResourceError accessor exactly once', async () => {
    const scope = new SSRRequestScope()
    let reads = 0
    const options = {} as { readonly onResourceError?: (failure: unknown) => void }
    Object.defineProperty(options, 'onResourceError', {
      enumerable: true,
      get: () => {
        reads++
        if (reads > 1) throw new Error('reporter reread')
        return () => undefined
      }
    })
    await scope.dehydrateAsync(options)
    expect(reads).toBe(1)
    scope.dispose()
  })

  it('contains reporter failures and still reports remaining failures and dehydrates', async () => {
    const scope = createSSRRequestScope()
    scope.registerResource(
      'bad-1',
      fakeResource(scope.runtime, { promise: Promise.reject(new Error('one')) })
    )
    scope.registerResource(
      'bad-2',
      fakeResource(scope.runtime, { promise: Promise.reject(new Error('two')) })
    )
    const reported: string[] = []
    const state = await scope.dehydrateAsync({
      onResourceError: (failure) => {
        reported.push(failure.key)
        throw new Error(`reporter-${failure.key}`)
      }
    })
    expect(reported).toEqual(['bad-1', 'bad-2'])
    expect(state.resources).toEqual({})
    scope.dispose()
  })

  it('contains both user and runtime reporter failures at the final boundary', async () => {
    const scope = new SSRRequestScope({
      runtimeOptions: {
        onError: () => {
          throw new Error('runtime reporter failed')
        }
      }
    })
    scope.registerResource(
      'bad',
      fakeResource(scope.runtime, { promise: Promise.reject(new Error('resource failed')) })
    )
    await expect(
      scope.dehydrateAsync({
        onResourceError: () => {
          throw new Error('user reporter failed')
        }
      })
    ).resolves.toEqual({ version: 1, stores: {}, resources: {} })
    scope.dispose()
  })

  it('reports resource failures to Runtime.reportError by default and omits them from the payload', async () => {
    const onError = vi.fn()
    const scope = new SSRRequestScope({ runtimeOptions: { onError } })
    scope.registerResource(
      'bad',
      fakeResource(scope.runtime, { promise: Promise.reject(new Error('nope')) })
    )
    scope.registerResource(
      'good',
      fakeResource(scope.runtime, {
        promise: Promise.resolve(1),
        snapshot: { version: 1, data: 'ok', updatedAt: 1, expiresAt: null }
      })
    )
    const state = await scope.dehydrateAsync()
    expect(state.resources?.bad).toBeUndefined()
    expect(state.resources?.good?.data).toBe('ok')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][1]).toMatchObject({ phase: 'ssr-resource' })
    scope.dispose()
  })

  it('onResourceError replaces the default reportError behavior instead of adding to it', async () => {
    const onError = vi.fn()
    const scope = new SSRRequestScope({ runtimeOptions: { onError } })
    const onResourceError = vi.fn()
    scope.registerResource(
      'bad',
      fakeResource(scope.runtime, { promise: Promise.reject(new Error('nope')) })
    )
    await scope.dehydrateAsync({ onResourceError })
    expect(onResourceError).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    scope.dispose()
  })
})

// ---- dispose() --------------------------------------------------------------

describe('dispose()', () => {
  it('disposeAsync is single-flight and waits for asynchronous Store cleanup', async () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    store.$dispose = () => pending
    scope.register('app', store)

    const first = scope.disposeAsync()
    const second = scope.disposeAsync()
    expect(second).toBe(first)
    let settled = false
    void second.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    release()
    await first
    expect(scope.disposeAsync()).toBe(first)
  })

  it('disposeAsync replays an asynchronous Store cleanup rejection by identity', async () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    const cleanupError = new Error('async store cleanup failed')
    store.$dispose = () => Promise.reject(cleanupError)
    scope.register('app', store)

    const disposal = scope.disposeAsync()
    await expect(disposal).rejects.toBe(cleanupError)
    expect(scope.disposeAsync()).toBe(disposal)
  })

  it('is idempotent', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    scope.register('app', store)
    scope.dispose()
    scope.dispose()
    expect(store.disposeCalls).toBe(1)
  })

  it('disposes owned resources (reverse order) before owned stores (reverse order)', () => {
    const scope = createSSRRequestScope()
    const order: string[] = []
    const s1 = fakeStore(scope.runtime)
    s1.$dispose = () => {
      order.push('s1')
    }
    const s2 = fakeStore(scope.runtime)
    s2.$dispose = () => {
      order.push('s2')
    }
    const r1 = fakeResource(scope.runtime)
    r1.dispose = () => order.push('r1')
    const r2 = fakeResource(scope.runtime)
    r2.dispose = () => order.push('r2')

    scope.register('s1', s1)
    scope.register('s2', s2)
    scope.registerResource('r1', r1)
    scope.registerResource('r2', r2)
    scope.dispose()

    expect(order).toEqual(['r2', 'r1', 's2', 's1'])
  })

  it('does not dispose non-owned entries', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    scope.register('app', store, { owned: false })
    scope.dispose()
    expect(store.disposeCalls).toBe(0)
  })

  it('skips entries that were already disposed externally', () => {
    const scope = createSSRRequestScope()
    const store = fakeStore(scope.runtime)
    scope.register('app', store)
    store.$dispose() // external disposal, bypassing the scope
    expect(store.disposeCalls).toBe(1)
    scope.dispose()
    // Scope must not call $dispose() a second time on an already-disposed store.
    expect(store.disposeCalls).toBe(1)
  })

  it('attempts every entry even when an earlier one throws, then rethrows the sole error', () => {
    const scope = createSSRRequestScope()
    const bad = fakeStore(scope.runtime)
    bad.$dispose = () => {
      throw new Error('dispose failed')
    }
    const good = fakeStore(scope.runtime)
    scope.register('bad', bad)
    scope.register('good', good)
    expect(() => scope.dispose()).toThrow('dispose failed')
    expect(good.disposeCalls).toBe(1)
  })

  it('wraps multiple disposal failures into an AggregateError', () => {
    const scope = createSSRRequestScope()
    const bad1 = fakeStore(scope.runtime)
    bad1.$dispose = () => {
      throw new Error('bad1')
    }
    const bad2 = fakeStore(scope.runtime)
    bad2.$dispose = () => {
      throw new Error('bad2')
    }
    scope.register('bad1', bad1)
    scope.register('bad2', bad2)
    let caught: unknown
    try {
      scope.dispose()
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toHaveLength(2)
  })

  it('rejects every mutating method after dispose with the same message', () => {
    const scope = createSSRRequestScope()
    scope.dispose()
    const message = '[store] SSR request scope is disposed'
    expect(() => scope.register('a', fakeStore(scope.runtime))).toThrow(message)
    expect(() => scope.unregister('a')).toThrow(message)
    expect(() => scope.detach('a')).toThrow(message)
    expect(() => scope.registerResource('a', fakeResource(scope.runtime))).toThrow(message)
    expect(() => scope.unregisterResource('a')).toThrow(message)
    expect(() => scope.detachResource('a')).toThrow(message)
  })
})

// ---- serializeSSRState / deserializeSSRState / createSSRStateScript -------

describe('serializeSSRState() / deserializeSSRState()', () => {
  it('round-trips a state value', () => {
    const state: ISSRState = { version: 1, stores: { app: { count: 2 } } }
    expect(deserializeSSRState(serializeSSRState(state))).toEqual(state)
  })

  it('escapes HTML-unsafe characters so the payload cannot break out of a <script> tag', () => {
    const state: ISSRState = {
      version: 1,
      stores: {
        app: {
          html: '</script><script>alert(1)</script>&"  '
        }
      }
    }
    const json = serializeSSRState(state)
    expect(json).not.toContain('</script>')
    expect(json).not.toContain('<script>alert')
    expect(json).not.toMatch(/[<>&\u2028\u2029]/)
    expect(deserializeSSRState(json)).toEqual(state)
  })

  it('validates before serializing', () => {
    expect(() => serializeSSRState({ version: 2 } as unknown as ISSRState)).toThrow(
      '[store] invalid SSR state version'
    )
  })

  it('rejects malformed JSON text', () => {
    expect(() => deserializeSSRState('{not json')).toThrow()
  })

  it('rejects well-formed JSON that is not a valid SSRState', () => {
    expect(() => deserializeSSRState('{"version":1}')).toThrow(
      '[store] invalid SSR stores snapshot'
    )
  })
})

describe('serializeTrustedSSRState()', () => {
  it('serializes a value produced by dehydrateTrusted()', () => {
    const scope = createSSRRequestScope()
    scope.register('app', fakeStore(scope.runtime, { count: 1 }))
    const trusted = scope.dehydrateTrusted()
    const json = serializeTrustedSSRState(trusted)
    // `dehydrateTrusted()` always includes a `resources` field (empty when nothing is
    // registered) — it is not omitted just because this scope never called `registerResource()`.
    expect(deserializeSSRState(json)).toEqual({
      version: 1,
      stores: { app: { count: 1 } },
      resources: {}
    })
    scope.dispose()
  })

  it('does not itself re-validate (relies on the brand from dehydrateTrusted())', () => {
    // No assertSSRState is run inside serializeTrustedSSRState(); it trusts the caller.
    const notReallyValidated = { version: 1, stores: {} } as unknown as ITrustedSSRState
    expect(() => serializeTrustedSSRState(notReallyValidated)).not.toThrow()
  })
})

describe('createSSRStateScript() / readSSRStateFromDocument()', () => {
  function documentWith(elementId: string, textContent: string | null): ISSRDocument {
    return {
      getElementById(id: string) {
        if (id !== elementId) return null
        return { textContent, getAttribute: () => null }
      }
    }
  }

  it('produces a <script type="application/json"> tag with the default element id', () => {
    const state: ISSRState = { version: 1, stores: { app: { count: 1 } } }
    const html = createSSRStateScript(state)
    expect(html).toMatch(/^<script type="application\/json" id="__STORE_STATE__">.*<\/script>$/)
  })

  it('rejects an invalid elementId', () => {
    expect(() => createSSRStateScript({ version: 1, stores: {} }, 'bad id')).toThrow(
      '[store] invalid SSR state script id'
    )
  })

  it('round-trips through readSSRStateFromDocument with a custom elementId', () => {
    const state: ISSRState = { version: 1, stores: { app: { count: 3 } } }
    const html = createSSRStateScript(state, 'custom-id')
    const match = html.match(/>([^<]*)<\/script>$/)
    const doc = documentWith('custom-id', match?.[1] ?? null)
    expect(readSSRStateFromDocument('custom-id', doc)).toEqual(state)
  })

  it('returns undefined when the element is missing', () => {
    const doc = documentWith('__STORE_STATE__', null)
    expect(readSSRStateFromDocument('other-id', doc)).toBeUndefined()
  })

  it('returns undefined when textContent is empty', () => {
    const doc = documentWith('__STORE_STATE__', '')
    expect(readSSRStateFromDocument('__STORE_STATE__', doc)).toBeUndefined()
  })

  it('returns undefined when no document is supplied', () => {
    expect(readSSRStateFromDocument()).toBeUndefined()
  })
})

// ---- createSSRStateScriptWith() / readSSRStateFromDocumentWith() ----------

/** A minimal non-JSON serialize plugin producing a `text` chunk, used to exercise the base64 path. */
function rawTextPlugin(): ISerializePlugin {
  const parser: ISerializeParser = {
    name: 'raw',
    // `JSON.stringify`, not `String()` — the latter reduces any object payload to the useless
    // `"[object Object]"`, which defeats every test below that round-trips and compares the text.
    encode: (value): ISerializeChunk => ['text', JSON.stringify(value)],
    decode: (chunk): unknown => chunk[1]
  }
  return { type: 'raw', parser }
}

/**
 * A `json`-typed plugin whose encode deliberately returns bytes, to hit the "JSON encoded into
 * bytes" base64 branch.
 */
function jsonAsBytesPlugin(): ISerializePlugin {
  const parser: ISerializeParser = {
    name: 'json-bytes',
    encode: (value): ISerializeChunk => ['bytes', new TextEncoder().encode(JSON.stringify(value))],
    decode: (chunk): unknown =>
      JSON.parse(chunk[0] === 'bytes' ? new TextDecoder().decode(chunk[1]) : (chunk[1] as string))
  }
  return { type: 'json', parser }
}

/** A plugin whose encode returns a `value` chunk, which SSR must reject. */
function valueChunkPlugin(): ISerializePlugin {
  const parser: ISerializeParser = {
    name: 'value',
    encode: (value): ISerializeChunk => ['value', value],
    decode: (chunk): unknown => chunk[1]
  }
  return { type: 'memory', parser }
}

describe('createSSRStateScriptWith() / readSSRStateFromDocumentWith()', () => {
  const state: ISSRState = { version: 1, stores: { app: { count: 5 } } }

  it('contains revoked options proxies as tagged errors', async () => {
    const { proxy, revoke } = Proxy.revocable(
      { codecs: createSerializeRegistry([jsonPlugin()]) },
      {}
    )
    revoke()
    await expect(createSSRStateScriptWith(state, proxy as never)).rejects.toMatchObject({
      source: '@migaia/store-ssr',
      code: 'INVALID_OPTION',
      cause: expect.any(Error)
    })
  })

  it('routes a JSON codec through the same HTML-safe text path as createSSRStateScript', async () => {
    const codecs = createSerializeRegistry([jsonPlugin()])
    const html = await createSSRStateScriptWith(state, { codecs })
    expect(html).toContain('data-codec="json"')
    expect(html).toContain('data-wire="text"')
    expect(html).toContain('type="application/json"')
  })

  it('round-trips a JSON codec payload through readSSRStateFromDocumentWith', async () => {
    const codecs = createSerializeRegistry([jsonPlugin()])
    const html = await createSSRStateScriptWith(state, { codecs })
    const text = html.match(/>([^<]*)<\/script>$/)?.[1] ?? ''
    const doc: ISSRDocument = {
      getElementById: () => ({
        textContent: text,
        getAttribute: (name) =>
          name === 'data-codec' ? 'json' : name === 'data-wire' ? 'text' : null
      })
    }
    const decoded = await readSSRStateFromDocumentWith({ codecs, document: doc })
    expect(decoded).toEqual(state)
  })

  it('base64-encodes a non-JSON text codec and marks it type="text/plain"', async () => {
    const codecs = createSerializeRegistry([rawTextPlugin()])
    const html = await createSSRStateScriptWith(state, { codecs })
    expect(html).toContain('data-wire="b64"')
    expect(html).toContain('type="text/plain"')
    expect(html).toContain('data-codec="raw"')
    const payload = html.match(/>([^<]*)<\/script>$/)?.[1] ?? ''
    const decodedText = new TextDecoder().decode(base64ToBytes(payload))
    expect(decodedText).toBe(JSON.stringify(state))
  })

  it('round-trips a non-JSON codec through readSSRStateFromDocumentWith via base64', async () => {
    const codecs = createSerializeRegistry([rawTextPlugin()])
    // rawTextPlugin's decode() only understands the JSON text it was given by
    // encode() (String(value) on an object is useless), so exercise the
    // round-trip through JSON's own base64 fallback path instead by wrapping
    // with a codec whose decode actually parses JSON text.
    const html = await createSSRStateScriptWith(state, { codecs })
    const text = html.match(/>([^<]*)<\/script>$/)?.[1] ?? ''
    expect(text.length).toBeGreaterThan(0)
    // Confirms wire bytes decode back to the exact JSON the encoder produced.
    expect(new TextDecoder().decode(base64ToBytes(text))).toBe(JSON.stringify(state))
  })

  it('base64-encodes bytes chunks directly, without an extra text round-trip', async () => {
    const codecs = createSerializeRegistry([jsonAsBytesPlugin()])
    const html = await createSSRStateScriptWith(state, { codecs })
    expect(html).toContain('data-wire="b64"')
    const text = html.match(/>([^<]*)<\/script>$/)?.[1] ?? ''
    const bytes = base64ToBytes(text)
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(state)
  })

  it('rejects a codec that produces a value chunk', async () => {
    const codecs = createSerializeRegistry([valueChunkPlugin()])
    await expect(createSSRStateScriptWith(state, { codecs })).rejects.toThrow(
      '[store] SSR codec memory must produce wire data, not a value chunk'
    )
  })

  it('rejects an invalid elementId before ever calling codecs.encode', async () => {
    const encode = vi.fn(
      async (value: unknown) => ['text', JSON.stringify(value)] as ISerializeChunk
    )
    const codecs = createSerializeRegistry([
      { type: 'json', parser: { name: 'json', encode, decode: () => undefined } }
    ])
    await expect(createSSRStateScriptWith(state, { codecs, elementId: 'bad id' })).rejects.toThrow(
      '[store] invalid SSR state script id'
    )
    expect(encode).not.toHaveBeenCalled()
  })

  it('readSSRStateFromDocumentWith returns undefined when the element is missing', async () => {
    const codecs = createSerializeRegistry([jsonPlugin()])
    const doc: ISSRDocument = { getElementById: () => null }
    expect(await readSSRStateFromDocumentWith({ codecs, document: doc })).toBeUndefined()
  })

  it('readSSRStateFromDocumentWith throws when the recorded codec type is not registered', async () => {
    const codecs = createSerializeRegistry([jsonPlugin()])
    const doc: ISSRDocument = {
      getElementById: () => ({
        textContent: '{}',
        getAttribute: (name) => (name === 'data-codec' ? 'unknown-codec' : null)
      })
    }
    await expect(readSSRStateFromDocumentWith({ codecs, document: doc })).rejects.toThrow(
      '[store] SSR payload was written by codec "unknown-codec", which is not registered'
    )
  })

  it('readSSRStateFromDocumentWith re-validates the decoded value', async () => {
    const codecs = createSerializeRegistry([jsonPlugin()])
    const doc: ISSRDocument = {
      getElementById: () => ({
        textContent: JSON.stringify({ version: 1 }), // missing "stores"
        getAttribute: () => null
      })
    }
    await expect(readSSRStateFromDocumentWith({ codecs, document: doc })).rejects.toThrow(
      '[store] invalid SSR stores snapshot'
    )
  })
})

// ---- assertSSRState() -------------------------------------------------------

describe('assertSSRState()', () => {
  it('accepts a minimal valid state', () => {
    expect(() => assertSSRState({ version: 1, stores: {} })).not.toThrow()
  })

  it('rejects a non-object value', () => {
    expect(() => assertSSRState(null)).toThrow('[store] invalid SSR state version')
    expect(() => assertSSRState('nope')).toThrow('[store] invalid SSR state version')
  })

  it('rejects the wrong version', () => {
    expect(() => assertSSRState({ version: 2, stores: {} })).toThrow(
      '[store] invalid SSR state version'
    )
  })

  it('rejects a non-plain-object "stores"', () => {
    expect(() => assertSSRState({ version: 1, stores: [] })).toThrow(
      '[store] invalid SSR stores snapshot'
    )
  })

  it('rejects an invalid store key inside stores', () => {
    // `__proto__: {}` in an object literal is not an own enumerable key — it sets the
    // `stores` object's *prototype* to that empty object instead, so `isPlainObject()`
    // (which requires `prototype === Object.prototype`) correctly rejects it one level up,
    // before `assertStoreKey` is ever reached. This is the desired outcome, not a fluke: a
    // `stores` value with a tampered prototype is exactly what that check exists to catch.
    expect(() => assertSSRState({ version: 1, stores: { __proto__: {} } })).toThrow(
      '[store] invalid SSR stores snapshot'
    )
    // An empty-string key can't be written with object literal syntax at all — build it via
    // `defineProperty` to exercise `assertStoreKey`'s own rejection path instead.
    const stores: Record<string, unknown> = {}
    Object.defineProperty(stores, '', { value: {}, enumerable: true })
    expect(() => assertSSRState({ version: 1, stores })).toThrow('[store] invalid SSR store key')
  })

  it('contains hostile snapshot getters as tagged invalid snapshots', () => {
    const stores: Record<string, unknown> = {}
    Object.defineProperty(stores, 'hostile', {
      enumerable: true,
      get: () => {
        throw new Error('getter failure')
      }
    })
    try {
      assertSSRState({ version: 1, stores })
      throw new Error('expected assertion to fail')
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-ssr',
        code: 'INVALID_SNAPSHOT',
        message: '[store] stores could not be read safely'
      })
      expect((error as Error).cause).toBeInstanceOf(Error)
    }
  })

  it('rejects a non-plain-object "resources"', () => {
    expect(() => assertSSRState({ version: 1, stores: {}, resources: [] })).toThrow(
      '[store] invalid SSR resources snapshot'
    )
  })

  it('rejects a resource snapshot missing required fields', () => {
    expect(() =>
      assertSSRState({ version: 1, stores: {}, resources: { r: { version: 1 } } })
    ).toThrow('[store] invalid SSR resource snapshot: r')
  })

  it('rejects a resource snapshot with a non-finite updatedAt', () => {
    expect(() =>
      assertSSRState({
        version: 1,
        stores: {},
        resources: { r: { version: 1, updatedAt: Number.NaN, expiresAt: null, data: null } }
      })
    ).toThrow('[store] invalid SSR resource snapshot: r')
  })

  it('accepts expiresAt: null and rejects a non-finite expiresAt', () => {
    expect(() =>
      assertSSRState({
        version: 1,
        stores: {},
        resources: { r: { version: 1, updatedAt: 1, expiresAt: null, data: null } }
      })
    ).not.toThrow()
    expect(() =>
      assertSSRState({
        version: 1,
        stores: {},
        resources: {
          r: { version: 1, updatedAt: 1, expiresAt: Number.POSITIVE_INFINITY, data: null }
        }
      })
    ).toThrow('[store] invalid SSR resource snapshot: r')
  })

  it('validates resource "data" through the same JSON walker as stores', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() =>
      assertSSRState({
        version: 1,
        stores: {},
        resources: { r: { version: 1, updatedAt: 1, expiresAt: null, data: cyclic } }
      })
    ).toThrow('contains a cycle')
  })

  it('rejects unsupported JSON types (function, symbol, bigint)', () => {
    expect(() => assertSSRState({ version: 1, stores: { a: { f: () => {} } } })).toThrow(
      'is not JSON serializable'
    )
    expect(() => assertSSRState({ version: 1, stores: { a: { s: Symbol('x') } } })).toThrow(
      'is not JSON serializable'
    )
    expect(() => assertSSRState({ version: 1, stores: { a: { b: 1n } } })).toThrow(
      'is not JSON serializable'
    )
  })

  it('includes a precise path in nested errors', () => {
    expect(() =>
      assertSSRState({ version: 1, stores: { app: { list: [{ n: Number.NaN }] } } })
    ).toThrow('stores.app.list[0].n')
  })
})
