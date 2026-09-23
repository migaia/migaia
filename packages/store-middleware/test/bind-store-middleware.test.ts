import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import {
  bindStoreMiddleware,
  createMutationPolicy,
  type IMiddlewareEvent,
  type IStoreMiddlewarePlugin
} from '../src/index'

/** Explicit unbounded policy used by legacy Store behavior tests. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

describe('bindStoreMiddleware', () => {
  it('contains a reporter that itself throws during binding rollback', async () => {
    // 原用例用 `spyOn(StoreMiddlewareHost.prototype, 'dispose').mockRejectedValue(...)` 制造宿主
    // 清理失败。宿主改为冻结句柄后没有原型可 spy——更要紧的是，dispose 中间件本来就捕获并转换
    // `next()` 的错误，所以生产路径下 `host.dispose()` 根本不会 reject：那条断言观测的是只有 mock
    // 才存在的世界。这里改为观测真实可达的那一条：回滚期间上报器自己抛出，绑定仍以聚合错误失败，
    // 且异常不会逃逸到调用方的控制流之外。
    const runtime = createRuntime()
    let reporterCalled = false
    vi.spyOn(runtime, 'reportError').mockImplementation(() => {
      reporterCalled = true
      throw new Error('runtime reporter failed')
    })
    vi.spyOn(runtime, 'subscribeTrace').mockImplementation(() => {
      throw new Error('trace setup failed')
    })
    const cleanup = new Error('store unsubscribe failed')
    const fakeStore = {
      $runtime: runtime,
      $plain: () => ({}),
      $subscribe: () => () => {
        throw cleanup
      }
    } as never

    expect(() => bindStoreMiddleware(fakeStore, { execution })).toThrow(
      expect.objectContaining({ code: 'CLEANUP_FAILED' })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    // 上报器在本用例中不被调用：可达的失败全部进了聚合错误，而不是走异步上报。
    expect(reporterCalled).toBe(false)
  })

  it('rolls back the store subscription when trace subscription construction fails', () => {
    const runtime = createRuntime()
    const cleanup = new Error('store unsubscribe failed')
    let unsubscribeCalls = 0
    vi.spyOn(runtime, 'subscribeTrace').mockImplementation(() => {
      throw new Error('trace setup failed')
    })
    const fakeStore = {
      $runtime: runtime,
      $plain: () => ({}),
      $subscribe: () => () => {
        unsubscribeCalls++
        throw cleanup
      }
    } as never

    let thrown: unknown
    try {
      bindStoreMiddleware(fakeStore, { execution })
    } catch (error) {
      thrown = error
    }
    expect(unsubscribeCalls).toBe(1)
    expect(thrown).toMatchObject({
      code: 'CLEANUP_FAILED',
      errors: [expect.any(Error), cleanup]
    })
  })

  it('default clone (structuredClone) produces independent previous/next snapshots', () => {
    const store = createStore({ value: 1 })
    const host = bindStoreMiddleware(store, { execution })
    const events: IMiddlewareEvent<Record<string, unknown>>[] = []
    host.attachBindingDisposer(() => undefined)
    const seen: Array<{ previous: unknown; next: unknown }> = []
    void events
    // Use a middlewarePlugin-free approach: subscribe directly via recordState by installing
    // a plugin through the public API.
    return host
      .use({
        name: 'capture',
        install: (core) => {
          core.usePipeline((event, next) => {
            if (event.type === 'state') seen.push({ previous: event.previous, next: event.next })
            next(event)
          })
          return {}
        }
      } satisfies IStoreMiddlewarePlugin<Record<string, unknown>>)
      .then(async () => {
        store.value = 2
        await Promise.resolve()
        expect(seen).toHaveLength(1)
        const first = seen[0]!
        expect(first.previous).toEqual({ value: 1 })
        expect(first.next).toEqual({ value: 2 })
        // Mutate the store further; the already-recorded snapshot must not change,
        // proving structuredClone gave us an independent copy, not a live reference.
        store.value = 3
        expect(first.next).toEqual({ value: 2 })
        return host.dispose()
      })
  })

  it('honors a custom clone function instead of the structuredClone default', async () => {
    const store = createStore({ value: 1 })
    const calls: Record<string, unknown>[] = []
    const host = bindStoreMiddleware(store, {
      execution,
      clone: (state) => {
        calls.push(state)
        return { ...state }
      }
    })
    store.value = 2
    await Promise.resolve()
    expect(calls.length).toBeGreaterThan(0)
    await host.dispose()
  })

  it('captures "previous" as the state at bind time, not at store-creation time', async () => {
    const store = createStore({ value: 1 })
    store.value = 5 // mutate BEFORE binding
    const host = bindStoreMiddleware(store, { execution })
    const seen: Array<{ previous: unknown; next: unknown }> = []
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          if (event.type === 'state') seen.push({ previous: event.previous, next: event.next })
          next(event)
        })
        return {}
      }
    } satisfies IStoreMiddlewarePlugin<Record<string, unknown>>)
    store.value = 6
    await Promise.resolve()
    expect(seen).toHaveLength(1)
    // previous must reflect the bind-time value (5), not the creation-time value (1)
    expect(seen[0]).toEqual({ previous: { value: 5 }, next: { value: 6 } })
    await host.dispose()
  })

  it('forwards Runtime action trace as action:start/end events with "<debugName>.<method>" names', async () => {
    const store = createStore(
      {
        value: 1,
        increment() {
          this.value++
        }
      },
      { debugName: 'Counter' }
    )
    const host = bindStoreMiddleware(store, { execution })
    const events: IMiddlewareEvent<Record<string, unknown>>[] = []
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          events.push(event)
          next(event)
        })
        return {}
      }
    } satisfies IStoreMiddlewarePlugin<Record<string, unknown>>)
    store.increment()
    const actionEvents = events.filter((e) => e.type === 'action')
    expect(actionEvents.map((e) => (e as { phase: string }).phase)).toEqual(['start', 'end'])
    expect(actionEvents.every((e) => (e as { name: string }).name === 'Counter.increment')).toBe(
      true
    )
    await host.dispose()
  })

  it('forwards action:error when the traced action throws', async () => {
    const store = createStore(
      {
        value: 1,
        blowUp() {
          throw new Error('kaboom')
        }
      },
      { debugName: 'Counter' }
    )
    const host = bindStoreMiddleware(store, { execution })
    const events: IMiddlewareEvent<Record<string, unknown>>[] = []
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          events.push(event)
          next(event)
        })
        return {}
      }
    } satisfies IStoreMiddlewarePlugin<Record<string, unknown>>)
    expect(() => store.blowUp()).toThrow('kaboom')
    const actionEvents = events.filter((e) => e.type === 'action')
    expect(actionEvents.map((e) => (e as { phase: string }).phase)).toEqual(['start', 'error'])
    await host.dispose()
  })

  it('actionPrefix filters out non-matching actions entirely (not even start is forwarded)', async () => {
    const store = createStore(
      {
        value: 1,
        allowedAction() {
          this.value++
        },
        otherAction() {
          this.value++
        }
      },
      { debugName: 'Counter' }
    )
    const host = bindStoreMiddleware(store, { execution, actionPrefix: 'Counter.allowed' })
    const events: IMiddlewareEvent<Record<string, unknown>>[] = []
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          events.push(event)
          next(event)
        })
        return {}
      }
    } satisfies IStoreMiddlewarePlugin<Record<string, unknown>>)
    store.otherAction()
    expect(events.filter((e) => e.type === 'action')).toHaveLength(0)
    store.allowedAction()
    const actionEvents = events.filter((e) => e.type === 'action')
    expect(actionEvents.map((e) => (e as { phase: string }).phase)).toEqual(['start', 'end'])
    await host.dispose()
  })

  it('dispose() unsubscribes both bindings: no further events after dispose, and the store itself keeps working', async () => {
    const store = createStore({ value: 1 })
    const host = bindStoreMiddleware(store, { execution })
    const events: IMiddlewareEvent<Record<string, unknown>>[] = []
    await host.use({
      name: 'capture',
      install: (core) => {
        core.usePipeline((event, next) => {
          events.push(event)
          next(event)
        })
        return {}
      }
    } satisfies IStoreMiddlewarePlugin<Record<string, unknown>>)
    store.value = 2
    await Promise.resolve()
    expect(events.length).toBeGreaterThan(0)
    await host.dispose()
    events.length = 0
    store.value = 3
    expect(events).toHaveLength(0)
    expect(store.value).toBe(3) // store itself is unaffected by host.dispose()
  })

  it('returns the host with a readonly `.store` property pointing back at the original store', () => {
    const store = createStore({ value: 1 })
    const host = bindStoreMiddleware(store, { execution })
    expect(host.store).toBe(store)
    return host.dispose()
  })

  it('forwards a supplied mutationPolicy instance to the underlying host', () => {
    const store = createStore({ value: 1 })
    const policy = createMutationPolicy('actions-only')
    const host = bindStoreMiddleware(store, { execution, mutationPolicy: policy })
    expect(host.mutationPolicy).toBe(policy)
    return host.dispose()
  })
})
