import { describe, expect, it } from 'vitest'
import { Resource } from '@migaia/resource'
import {
  createSSRRequestScope,
  assertSSRState,
  deserializeSSRState,
  serializeSSRState,
  readSSRStateFromDocument,
  type ISSRStore
} from '../src/index.js'

/** Complete application Store port with real Runtime ownership and idempotent caller cleanup. */
function memoryStore(
  runtime: ISSRStore['$runtime'],
  onHydrate?: () => void,
  onDispose?: () => void | PromiseLike<void>
): ISSRStore {
  /** This adapter owns the business snapshot; SSR owns it only after a successful registration. */
  const data: Record<string, unknown> = {}
  /** The public terminal flag tracks this actual adapter's cleanup. */
  let disposed = false
  return {
    $runtime: runtime,
    get $disposed() {
      return disposed
    },
    $plain() {
      return { ...data }
    },
    $hydrate(next) {
      Object.assign(data, next)
      onHydrate?.()
    },
    $dispose() {
      if (disposed) return
      disposed = true
      return onDispose?.()
    }
  }
}

describe('store-ssr audit regressions', () => {
  it('SSR-D01 rejects Store admission when pending hydration closes the scope', async () => {
    /** Pending hydration is genuine scope state entered through its public API. */
    const scope = createSSRRequestScope()
    scope.hydrate({ version: 1, stores: { app: { count: 1 } } })
    /** The complete adapter closes the owner from its supported synchronous hydration callback. */
    const store = memoryStore(scope.runtime, () => scope.dispose())
    try {
      expect(() => scope.register('app', store)).toThrow(
        expect.objectContaining({ source: '@migaia/store-ssr', code: 'SCOPE_DISPOSED' })
      )
      expect(scope.disposed).toBe(true)
      expect(store.$plain()).toEqual({ count: 1 })
      // Failed admission never transfers ownership; the caller retains this hydrated candidate.
      expect(store.$disposed).toBe(false)
    } finally {
      await store.$dispose()
      await scope.disposeAsync()
    }
  })

  it('SSR-D01 applies the same post-hydration admission check to a real Resource', async () => {
    /** This actual Resource cache snapshot is pending before its candidate is registered. */
    const scope = createSSRRequestScope()
    scope.hydrate({
      version: 1,
      stores: {},
      resources: {
        item: { version: 2, data: 7, ageMs: 0, remainingTtlMs: 1000 }
      }
    })
    /**
     * Override only the public callback; all cache, promise and disposal behavior remains
     * canonical.
     */
    class ClosingResource extends Resource<number> {
      override hydrate(snapshot: Parameters<Resource<number>['hydrate']>[0]): void {
        super.hydrate(snapshot)
        scope.dispose()
      }
    }
    /** The candidate is still caller-owned until the registry commits. */
    const resource = new ClosingResource(async () => 0, scope.runtime)
    try {
      expect(() => scope.registerResource('item', resource)).toThrow(
        expect.objectContaining({ source: '@migaia/store-ssr', code: 'SCOPE_DISPOSED' })
      )
      expect(resource.disposed).toBe(false)
      expect(resource.state.status).toBe('success')
    } finally {
      resource.dispose()
      await scope.disposeAsync()
    }
  })

  it.each(['async', 'sync'] as const)(
    'SSR-D02 shares completion during %s disposal and waits for every cleanup',
    async (entry) => {
      /** These complete Store ports use the actual scope Runtime and cleanup accounting. */
      const scope = createSSRRequestScope()
      /** Keep a different Store's cleanup pending while the later registration observes completion. */
      let release!: () => void
      /** No disposer returns the scope completion itself, so the fixture creates no self-deadlock. */
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      /** Reentrant observation happens on the synchronous callback stack. */
      let nested: Promise<void> | undefined
      scope.register(
        'slow',
        memoryStore(scope.runtime, undefined, () => gate)
      )
      scope.register(
        'observer',
        memoryStore(scope.runtime, undefined, () => {
          nested = scope.disposeAsync()
        })
      )
      /** This call starts both callbacks before returning its published completion. */
      if (entry === 'sync') scope.dispose()
      const outer = scope.disposeAsync()
      /** Record actual settlement without awaiting a deliberately still-pending Promise. */
      let completed = false
      void nested?.then(() => {
        completed = true
      })
      try {
        expect(nested).toBe(outer)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(completed).toBe(false)
      } finally {
        release()
        await outer
      }
      expect(completed).toBe(true)
      expect(scope.disposeAsync()).toBe(outer)
    }
  )

  it.each([0, 10])(
    'SSR-D03 excludes already settled resources from a %sms timeout',
    async (timeoutMs) => {
      /** Both resources are canonical Resource instances; only the second loader remains pending. */
      const scope = createSSRRequestScope()
      /** A successful cache entry is explicitly settled before the SSR wait begins. */
      const ready = new Resource(async () => 7, scope.runtime, { ttl: 60_000 })
      await ready.promise
      /** Pending native work has no fabricated state or readonly result mutation. */
      const pending = new Resource(() => new Promise<never>(() => {}), scope.runtime)
      scope.registerResource('ready', ready)
      scope.registerResource('pending', pending)
      /** Record exactly the failure keys/code at the public reporting boundary. */
      const failures: Array<{ key: string; error: unknown }> = []
      try {
        /** The successful cache remains eligible for dehydration even when the other item times out. */
        const state = await scope.dehydrateAsync({
          timeoutMs,
          onResourceError: (failure) => {
            failures.push(failure)
          }
        })
        expect(failures.map((failure) => failure.key)).toEqual(['pending'])
        expect(failures[0]?.error).toMatchObject({
          source: '@migaia/store-ssr',
          code: 'RESOURCE_TIMEOUT'
        })
        expect(state.resources?.ready.data).toBe(7)
      } finally {
        await scope.disposeAsync()
      }
    }
  )

  it('SSR-D04 reads the client payload through the complete explicitly injected document port', () => {
    /** Runtime-neutral decoding reads this complete structural host instead of a hidden global DOM. */
    const text = serializeSSRState({ version: 1, stores: { app: { count: 7 } } })
    expect(
      readSSRStateFromDocument(undefined, {
        getElementById(id) {
          return id === '__STORE_STATE__' ? { textContent: text, getAttribute: () => null } : null
        }
      })?.stores.app.count
    ).toBe(7)
    expect(readSSRStateFromDocument()).toBeUndefined()
  })

  it.each(['version', 'stores', 'resources'] as const)(
    'SSR-D05 codes an inaccessible %s without replacing the native error',
    (key) => {
      /** This native application error must keep its original class and exact identity. */
      const original = new TypeError('state getter failed')
      /** Public unknown input legitimately contains accessors. */
      const state = { version: 1, stores: {}, resources: undefined }
      Object.defineProperty(state, key, {
        get() {
          throw original
        }
      })
      expect(() => assertSSRState(state)).toThrow(original)
      expect(original).toMatchObject({ source: '@migaia/store-ssr', code: 'INVALID_SNAPSHOT' })
      expect(original.stack).toBeTruthy()
    }
  )

  it('SSR-D05 keeps native JSON SyntaxError while adding the invalid-state-script identity', () => {
    expect(() => deserializeSSRState('{')).toThrow(SyntaxError)
    expect(() => deserializeSSRState('{')).toThrow(
      expect.objectContaining({ source: '@migaia/store-ssr', code: 'INVALID_STATE_SCRIPT' })
    )
  })
})
