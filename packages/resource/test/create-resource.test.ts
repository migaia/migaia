import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createRuntime, defaultRuntime } from '@migaia/reactive'
import { ConfigOwner } from '@migaia/utils/config'
import { createResource, Resource, type IResourceState } from '../src/index.js'
import { deferred, flushAsync } from './helpers.js'

describe('createResource', () => {
  it('builds a Resource from a setup callback and infers the data type', async () => {
    /** Explicit runtime under test. */
    const runtime = createRuntime()
    /** Setup context seen by the callback. */
    let seen: { runtime: unknown; aborted: boolean } | undefined
    /** Resource under test. */
    const resource = createResource(
      (ctx) => {
        seen = { runtime: ctx.runtime, aborted: ctx.signal.aborted }
        return async () => ({ id: 1 })
      },
      { runtime, debugName: 'user' }
    )
    expectTypeOf(resource).toEqualTypeOf<Resource<{ id: number }>>()
    expect(resource).toBeInstanceOf(Resource)
    expect(seen).toEqual({ runtime, aborted: false })
    await expect(resource.promise).resolves.toEqual({ id: 1 })
    resource.dispose()
  })

  it('defaults to the reactive default runtime', () => {
    /** Resource without an explicit runtime. */
    const resource = createResource(() => () => 1, { autoStart: false })
    expect(resource.runtime).toBe(defaultRuntime)
    resource.dispose()
  })

  it('aborts the setup signal and runs cleanups in reverse order on dispose, once', () => {
    /** Cleanup order. */
    const order: string[] = []
    /** Captured setup signal. */
    let signal: { aborted: boolean } | undefined
    /** Resource under test. */
    const resource = createResource(
      (ctx) => {
        signal = ctx.signal
        ctx
          .onDispose(() => order.push(`first:${String(ctx.signal.aborted)}`))
          .onDispose(() => order.push('second'))
        return () => 1
      },
      { runtime: createRuntime(), autoStart: false }
    )
    resource.dispose()
    resource.dispose()
    expect(order).toEqual(['second', 'first:true'])
    expect(signal?.aborted).toBe(true)
  })

  it('supports using declarations through Symbol.dispose', () => {
    /** Cleanup spy. */
    const cleanup = vi.fn()
    {
      using resource = createResource(
        (ctx) => {
          ctx.onDispose(cleanup)
          return () => 1
        },
        { runtime: createRuntime(), autoStart: false }
      )
      expect(resource.disposed).toBe(false)
    }
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('rolls back registered cleanups when setup throws and keeps the primary error first', () => {
    /** Primary failure thrown by setup. */
    const failure = new Error('setup')
    /** Failing cleanup whose error must be attached, not substituted. */
    const cleanupFailure = new Error('cleanup')
    /** Successful cleanup that must still run. */
    const cleanup = vi.fn()
    /** Thrown value. */
    let thrown: unknown
    try {
      createResource(
        (ctx) => {
          ctx.onDispose(cleanup).onDispose(() => {
            throw cleanupFailure
          })
          throw failure
        },
        { runtime: createRuntime() }
      )
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(failure)
    expect((thrown as { errors: unknown[] }).errors).toEqual([cleanupFailure])
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('rejects invalid setups and fetchers with RESOURCE_SETUP_INVALID', () => {
    expect(() => createResource(1 as never)).toThrowError(
      expect.objectContaining({ name: 'TypeError', code: 'RESOURCE_SETUP_INVALID' })
    )
    /** Cleanup registered before the invalid return. */
    const cleanup = vi.fn()
    expect(() =>
      createResource(
        (ctx) => {
          ctx.onDispose(cleanup)
          return 1 as never
        },
        { runtime: createRuntime() }
      )
    ).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_SETUP_INVALID', source: '@migaia/resource' })
    )
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('rolls back when Resource options are invalid', () => {
    /** Cleanup that must run when construction fails. */
    const cleanup = vi.fn()
    expect(() =>
      createResource(
        (ctx) => {
          ctx.onDispose(cleanup)
          return () => 1
        },
        { runtime: createRuntime(), ttl: -1 }
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION' }))
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('closes the setup context once setup returns', () => {
    /** Escaped context. */
    let escaped: { onDispose(cleanup: () => void): unknown } | undefined
    /** Resource under test. */
    const resource = createResource(
      (ctx) => {
        escaped = ctx
        return () => 1
      },
      { runtime: createRuntime(), autoStart: false }
    )
    expect(() => escaped?.onDispose(() => undefined)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_SETUP_CLOSED' })
    )
    resource.dispose()
  })

  it('pairs with ConfigOwner.fromAsync to produce a config resource', async () => {
    /** Config resource loaded from JSON text. */
    const config = createResource(
      ({ signal }) =>
        () =>
          ConfigOwner.fromAsync<{ port: number }>(Promise.resolve('{"port":8080}'), { signal }),
      { runtime: createRuntime() }
    )
    /** Loaded owner. */
    const owner = await config.promise
    expect(owner.get('port')).toBe(8080)
    config.dispose()
  })
})

describe('Resource additions', () => {
  it('mutates data locally, supersedes in-flight requests and supports updaters', async () => {
    /** In-flight request controlled by the test. */
    const request = deferred<number>()
    /** Resource under test. */
    const resource = new Resource(() => request.promise, createRuntime())
    expect(resource.mutate(5)).toBe(resource)
    expect(resource.peekState()).toEqual({ status: 'success', data: 5 })
    await expect(resource.promise).resolves.toBe(5)
    request.resolve(1)
    await flushAsync()
    expect(resource.peek()).toBe(5)
    resource.mutate((previous) => (previous ?? 0) + 1)
    expect(resource.peek()).toBe(6)
    /** Failing updater must not change state. */
    const failure = new Error('updater')
    expect(() =>
      resource.mutate(() => {
        throw failure
      })
    ).toThrow(failure)
    expect(resource.peek()).toBe(6)
    resource.dispose()
    expect(() => resource.mutate(1)).toThrowError(
      expect.objectContaining({ code: 'RESOURCE_DISPOSED' })
    )
  })

  it('subscribes outside the reactive graph and reports listener failures', async () => {
    /** Runtime that records reported errors. */
    const runtime = createRuntime()
    /** Report spy. */
    const report = vi.spyOn(runtime, 'reportError').mockImplementation(() => undefined)
    /** Resource under test. */
    const resource = new Resource(async () => 1, runtime)
    /** Delivered states. */
    const states: IResourceState<number>[] = []
    /** Listener failure. */
    const failure = new Error('listener')
    /** Unsubscribe handle. */
    const stop = resource.subscribe((state) => {
      states.push(state)
      if (state.status === 'success') throw failure
    })
    await resource.promise
    await flushAsync()
    runtime.flush()
    expect(states.map((state) => state.status)).toEqual(['pending', 'success'])
    expect(report).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({ phase: 'subscription-listener' })
    )
    stop()
    stop()
    resource.mutate(2)
    runtime.flush()
    expect(states).toHaveLength(2)
    expect(() => resource.subscribe(1 as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    resource.dispose()
  })

  it('selects derived values and disposes them with the resource', async () => {
    /** Resource under test. */
    const resource = new Resource(async () => [1, 2, 3], createRuntime())
    /** Derived length. */
    const length = resource.select((list) => list.length)
    expectTypeOf(length.value).toEqualTypeOf<number | undefined>()
    await resource.promise
    expect(length.value).toBe(3)
    resource.mutate([1])
    expect(length.value).toBe(1)
    resource.dispose()
  })
})
