/* oxlint-disable unicorn/no-thenable -- adversarial fixtures verify lifecycle thenable admission. */
import { describe, expect, it, vi } from 'vitest'
import { ResourceOwnershipRegistry } from '../src/store-resource-ownership.js'
import { ResourceCachePolicy } from '../src/store-resource-cache-policy.js'
import { createStoreResource, createStoreResourceScope } from '../src/store-resource.js'

describe('ResourceOwnershipRegistry (M-T42)', () => {
  it('rejects invalid factory and options shapes before creating resource state', () => {
    expect(() => createStoreResource(null as never)).toThrow(
      '[store] resource factory must be a function or an object with a load function'
    )
    expect(() => createStoreResource({ load: 1 } as never)).toThrow(
      '[store] resource factory must be a function or an object with a load function'
    )
    expect(() => createStoreResource(() => 1, null as never)).toThrow(
      '[store] store options must be an object'
    )
  })

  it('contains revoked factory and options proxies as tagged errors', () => {
    const factory = Proxy.revocable({ load: () => 1 }, {})
    factory.revoke()
    expect(() => createStoreResource(factory.proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-light',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    const options = Proxy.revocable({}, {})
    options.revoke()
    expect(() => createStoreResource(() => 1, options.proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-light',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
  })

  it('contains throwing factory and options getters as tagged errors', () => {
    expect(() =>
      createStoreResource({
        get load() {
          throw new Error('load getter failed')
        }
      } as never)
    ).toThrow(
      expect.objectContaining({
        source: '@migaia/store-light',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    expect(() =>
      createStoreResource(() => 1, {
        get keepAliveMs() {
          throw new Error('option getter failed')
        }
      } as never)
    ).toThrow(
      expect.objectContaining({
        source: '@migaia/store-light',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
  })

  it('reads a stateful load getter once and ignores unknown enumerable getters', async () => {
    let loadReads = 0
    let unknownReads = 0
    let unknownEnumerations = 0
    const resource = createStoreResource(
      new Proxy(
        {
          get load() {
            loadReads++
            if (loadReads > 1) throw new Error('load getter reread')
            return () => 42
          },
          get unknown() {
            unknownReads++
            throw new Error('unknown getter read')
          }
        },
        {
          ownKeys() {
            unknownEnumerations++
            throw new Error('factory keys enumerated')
          }
        }
      ) as never
    )

    resource.preload()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(resource.read()).toBe(42)
    expect(loadReads).toBe(1)
    expect(unknownReads).toBe(0)
    expect(unknownEnumerations).toBe(0)
    resource.forceDispose()
  })

  it('reads known factory/options accessors once and preserves explicit-option precedence', async () => {
    let factoryDisposeReads = 0
    let optionDisposeReads = 0
    let factoryDisposeCalls = 0
    let optionDisposeCalls = 0
    const value = {}
    const resource = createStoreResource(
      {
        load: () => value,
        get dispose() {
          factoryDisposeReads++
          return () => {
            factoryDisposeCalls++
          }
        }
      },
      {
        get dispose() {
          optionDisposeReads++
          return () => {
            optionDisposeCalls++
          }
        }
      }
    )

    resource.preload()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    resource.forceDispose()

    expect(factoryDisposeReads).toBe(1)
    expect(optionDisposeReads).toBe(1)
    expect(factoryDisposeCalls).toBe(0)
    expect(optionDisposeCalls).toBe(1)
  })

  it.each(['dispose', 'onError', 'onTerminal'] as const)(
    'rejects an invalid %s callback during construction',
    (key) => {
      expect(() => createStoreResource(() => 1, { [key]: 1 } as never)).toThrow(
        expect.objectContaining({
          source: '@migaia/store-light',
          code: 'INVALID_OPTION'
        })
      )
    }
  )

  it('forceReset() invalidates pre-reset release closures: no decrement, no onRelease', () => {
    const registry = new ResourceOwnershipRegistry<object>()
    let onReleaseCalls = 0
    const release = registry.retainResource(() => {
      onReleaseCalls++
    })
    expect(registry.hasOwners).toBe(true)

    registry.forceReset()

    // 旧 release 闭包在 reset 之后调用：计数器不再减、onRelease 不被调用。
    release()
    expect(registry.hasOwners).toBe(false)
    expect(onReleaseCalls).toBe(0)
  })

  it('release obtained after reset() still works normally', () => {
    const registry = new ResourceOwnershipRegistry<object>()
    let onReleaseCalls = 0
    registry.forceReset()
    const release = registry.retainResource(() => {
      onReleaseCalls++
    })
    expect(registry.hasOwners).toBe(true)
    release()
    expect(registry.hasOwners).toBe(false)
    expect(onReleaseCalls).toBe(1)
  })

  it('retainVersion release after reset is a no-op too', () => {
    const registry = new ResourceOwnershipRegistry<object>()
    let onReleaseCalls = 0
    const release = registry.retainVersion(1, () => {
      onReleaseCalls++
    })
    expect(registry.hasVersionOwners).toBe(true)

    registry.forceReset()

    release()
    expect(registry.hasVersionOwners).toBe(false)
    expect(onReleaseCalls).toBe(0)
  })
})

describe('ResourceCachePolicy timer boundary', () => {
  it('caps oversized keep-alive delays instead of passing an overflowing timer', () => {
    vi.useFakeTimers()
    try {
      const policy = new ResourceCachePolicy(2_147_483_648)
      const evict = vi.fn()
      policy.scheduleEviction(evict)
      expect(vi.getTimerCount()).toBe(1)
      vi.advanceTimersByTime(2_147_483_647)
      expect(evict).not.toHaveBeenCalled()
      policy.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createStoreResource disposer admission', () => {
  it('reads and invokes captured disposer/then functions exactly once with their original receivers', async () => {
    let disposerReads = 0
    let disposerCalls = 0
    let thenReads = 0
    let thenCalls = 0
    const failures: unknown[] = []
    const thenable = {
      get then() {
        thenReads++
        if (thenReads > 1) throw new Error('then getter reread')
        return function (this: unknown, resolve: () => void) {
          thenCalls++
          expect(this).toBe(thenable)
          resolve()
        }
      }
    }
    const value = Object.defineProperty({}, '$dispose', {
      get() {
        disposerReads++
        if (disposerReads > 1) throw new Error('disposer getter reread')
        return function (this: unknown) {
          disposerCalls++
          expect(this).toBe(value)
          return thenable
        }
      }
    })
    const resource = createStoreResource(() => value, {
      onError: (error, phase) => {
        if (phase === 'dispose') failures.push(error)
      }
    })

    resource.preload()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    resource.forceDispose()
    resource.forceDispose()
    await resource.whenTerminal()
    await Promise.resolve()

    expect(disposerReads).toBe(1)
    expect(disposerCalls).toBe(1)
    expect(thenReads).toBe(1)
    expect(thenCalls).toBe(1)
    expect(failures).toEqual([])
  })

  it('reports disposer getter, call, then getter, and rejection failures by identity', async () => {
    const disposerGetterFailure = new Error('disposer getter failed')
    const disposerCallFailure = new Error('disposer call failed')
    const thenGetterFailure = new Error('then getter failed')
    const rejectionFailure = new Error('dispose rejected')
    const failures: unknown[] = []
    const values = [
      Object.defineProperty({}, '$dispose', {
        get() {
          throw disposerGetterFailure
        }
      }),
      {
        $dispose() {
          throw disposerCallFailure
        }
      },
      {
        $dispose() {
          return Object.defineProperty({}, 'then', {
            get() {
              throw thenGetterFailure
            }
          })
        }
      },
      {
        $dispose() {
          return Promise.reject(rejectionFailure)
        }
      }
    ]

    for (const value of values) {
      const resource = createStoreResource(() => value, {
        onError: (error, phase) => {
          if (phase === 'dispose') failures.push(error)
        }
      })
      resource.preload()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      resource.forceDispose()
      resource.forceDispose()
      await resource.whenTerminal()
    }
    await Promise.resolve()

    expect(failures).toEqual([
      disposerGetterFailure,
      disposerCallFailure,
      thenGetterFailure,
      rejectionFailure
    ])
  })
})

describe('createStoreResourceScope delegation', () => {
  it('preserves canonical known-field admission without enumerating factory keys', async () => {
    let loadReads = 0
    let ownKeysCalls = 0
    const scope = createStoreResourceScope()
    const resource = scope.resource(
      new Proxy(
        {
          get load() {
            loadReads++
            return () => 42
          }
        },
        {
          ownKeys() {
            ownKeysCalls++
            throw new Error('scope enumerated factory keys')
          }
        }
      ) as never
    )

    resource.preload()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(resource.read()).toBe(42)
    expect(loadReads).toBe(1)
    expect(ownKeysCalls).toBe(0)
    scope.dispose()
  })

  it('preserves factory onTerminal and forgets naturally terminal resources', async () => {
    let terminalCalls = 0
    const scope = createStoreResourceScope()
    const resource = scope.resource({
      load: () => 1,
      onTerminal: () => {
        terminalCalls++
      }
    })
    const originalForceDispose = resource.forceDispose

    resource.forceDispose()
    await resource.whenTerminal()
    await Promise.resolve()
    resource.forceDispose = vi.fn(() => originalForceDispose())
    scope.dispose()

    expect(terminalCalls).toBe(1)
    expect(resource.forceDispose).not.toHaveBeenCalled()
  })
})

describe('createStoreResource getSnapshot stability (M-T43)', () => {
  it('getSnapshot() returns the same value across consecutive calls until a load notifies', async () => {
    const resource = createStoreResource<number>({
      load: async () => 1
    })
    const before = resource.getSnapshot()
    expect(resource.getSnapshot()).toBe(before) // 稳定：无变更时严格返回同值

    resource.preload()
    // 让 async load settle + notify 跑完。
    await new Promise((resolve) => setTimeout(resolve, 0))

    const after = resource.getSnapshot()
    expect(after).toBeGreaterThan(before) // 每次 notify() 严格 +1
    expect(resource.getSnapshot()).toBe(after) // 再次稳定
  })
})

describe('createStoreResource reporter failure policy', () => {
  it('routes a reporter failure to the host sink without changing resource state', async () => {
    const reported: unknown[] = []
    const previous = (globalThis as { reportError?: (error: unknown) => void }).reportError
    ;(globalThis as { reportError?: (error: unknown) => void }).reportError = (error) => {
      reported.push(error)
    }
    const resource = createStoreResource(
      async () => {
        throw new Error('load failed')
      },
      {
        onError: () => {
          throw new Error('reporter failed')
        }
      }
    )
    try {
      resource.preload()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(reported).toHaveLength(1)
      expect(reported[0]).toMatchObject({ message: 'reporter failed' })
      expect(() => resource.read()).toThrow('load failed')
    } finally {
      resource.dispose()
      if (previous)
        (globalThis as { reportError?: (error: unknown) => void }).reportError = previous
      else delete (globalThis as { reportError?: (error: unknown) => void }).reportError
    }
  })
})
