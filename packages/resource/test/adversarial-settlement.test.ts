/* oxlint-disable unicorn/no-thenable -- 对抗夹具刻意构造 hostile then getter 以验证单次探测语义 */
import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { LifecycleErrorCode } from '@migaia/lifecycle'
import { Resource } from '../src/index.ts'
import { ResourceErrorCode } from '../src/error-code.ts'

describe('Suspense throw then-getter probe', () => {
  it('surfaces the getter error and keeps the thrown value reachable', async () => {
    const runtime = createRuntime()
    const getterError = new Error('then getter boom')
    let reads = 0
    const thrown = {
      get then() {
        reads += 1
        throw getterError
      }
    }
    const resource = new Resource(() => {
      throw thrown
    }, runtime)
    let rejection: (Error & { errors?: unknown[]; code?: string }) | undefined
    await resource.promise.catch((error: unknown) => {
      rejection = error as Error & { errors?: unknown[]; code?: string }
    })
    expect(rejection?.code).toBe('SUSPENSE_PROBE_FAILED')
    expect(rejection?.errors?.[0]).toBe(thrown)
    expect(rejection?.errors?.[1]).toBe(getterError)
    expect(reads).toBe(1)
    resource.dispose()
  })
})

describe('Resource scheduler.now boundary', () => {
  it('wraps a scheduler.now throw during successful settlement and publishes no success/cache', async () => {
    const runtime = createRuntime()
    const clockError = new Error('settlement clock failed')
    const scheduler = {
      now: () => {
        throw clockError
      },
      schedule: () => ({ cancel: () => undefined })
    }
    const resource = new Resource(async () => 'value', runtime, { scheduler })

    const rejection = await resource.promise.catch((error: unknown) => error)

    expect(rejection).toMatchObject({
      source: 'resource',
      code: ResourceErrorCode.invalidOption,
      message: 'resource scheduler task operation failed',
      cause: clockError
    })
    expect(resource.state).toEqual({ status: 'error', error: rejection })
    expect(resource.dehydrate()).toBeUndefined()
    resource.dispose()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'wraps scheduler.now()=%s validation with Resource ownership and preserves native cause',
    async (invalidNow) => {
      const runtime = createRuntime()
      const scheduler = {
        now: () => invalidNow,
        schedule: () => ({ cancel: () => undefined })
      }
      const resource = new Resource(async () => 'value', runtime, { scheduler })

      const rejection = await resource.promise.catch((error: unknown) => error)
      const cause = (rejection as { cause?: unknown }).cause

      expect(rejection).toMatchObject({
        source: 'resource',
        code: ResourceErrorCode.invalidOption,
        message: 'resource scheduler task operation failed'
      })
      expect(cause).toMatchObject({
        source: 'lifecycle',
        code: LifecycleErrorCode.invalidOption
      })
      expect(cause).toBeInstanceOf(RangeError)
      expect(resource.state).toEqual({ status: 'error', error: rejection })
      expect(resource.dehydrate()).toBeUndefined()
      resource.dispose()
    }
  )

  it('makes repeated passive freshness reads fail closed with one wrapper, stable promise, atomic cache metadata, and reporter identity', async () => {
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    /** Enable the passive clock failure only after v2 admission/dehydration clock samples. */
    let failClock = false
    let nowCalls = 0
    const clockError = new Error('passive clock failed')
    const scheduler = {
      now: () => {
        nowCalls++
        if (failClock) throw clockError
        return 0
      },
      schedule: () => ({ cancel: () => undefined })
    }
    const snapshot = { version: 2 as const, data: 'cached', ageMs: 1, remainingTtlMs: 10 }
    const resource = new Resource(async () => 'unused', runtime, {
      autoStart: false,
      initialSnapshot: snapshot,
      scheduler
    })

    expect(resource.dehydrate()).toEqual(snapshot)
    nowCalls = 0
    failClock = true
    const state = resource.state
    expect(state.status).toBe('error')
    const failure = (state as { status: 'error'; error: unknown }).error
    expect(failure).toMatchObject({
      source: 'resource',
      code: ResourceErrorCode.invalidOption,
      cause: clockError
    })
    expect(reported).toHaveLength(1)
    expect(reported[0]).toBe(failure)
    expect(() => resource.peek()).toThrow(failure)
    expect(resource.isStale).toBe(false)
    const firstPromise = resource.promise
    const secondPromise = resource.promise
    expect(secondPromise).toBe(firstPromise)
    await expect(firstPromise).rejects.toBe(failure)
    expect(() => resource.read()).toThrow(failure)
    expect(nowCalls).toBe(1)
    expect(resource.dehydrate()).toBeUndefined()
    resource.dispose()
  })

  it('preserves the retry boundary when the retried success settlement clock fails', async () => {
    const runtime = createRuntime()
    const clockError = new Error('retry settlement clock failed')
    let attempts = 0
    let retryCallback: (() => void) | undefined
    const scheduler = {
      now: () => {
        throw clockError
      },
      schedule: (callback: () => void) => {
        retryCallback = callback
        return { cancel: () => undefined }
      }
    }
    const resource = new Resource(
      async () => {
        attempts++
        if (attempts === 1) throw new Error('first attempt failed')
        return 'retried'
      },
      runtime,
      { retry: 1, retryDelay: 10, scheduler }
    )
    const request = resource.promise

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(attempts).toBe(1)
    retryCallback?.()
    const rejection = await request.catch((error: unknown) => error)

    expect(attempts).toBe(2)
    expect(rejection).toMatchObject({
      source: 'resource',
      code: ResourceErrorCode.invalidOption,
      cause: clockError
    })
    resource.dispose()
  })

  it('SWR/keepAlive success settlement clock failure keeps refresh atomic and does not suspend dependencies', async () => {
    const runtime = createRuntime()
    const dependency = runtime.signal(1)
    let nowCalls = 0
    const clockError = new Error('SWR settlement clock failed')
    let fetches = 0
    const scheduler = {
      now: () => {
        nowCalls++
        if (nowCalls > 1) throw clockError
        return 0
      },
      schedule: () => ({ cancel: () => undefined })
    }
    const resource = new Resource(
      async () => {
        void dependency.value
        fetches++
        return fetches
      },
      runtime,
      { keepAlive: true, staleWhileRevalidate: true, scheduler }
    )

    await expect(resource.promise).resolves.toBe(1)
    const refresh = resource.refetch()
    expect(resource.state).toEqual({ status: 'success', data: 1, refreshing: true })
    const rejection = await refresh.catch((error: unknown) => error)

    expect(rejection).toMatchObject({
      source: 'resource',
      code: ResourceErrorCode.invalidOption,
      cause: clockError
    })
    expect(resource.state).toEqual({ status: 'error', error: rejection })
    expect(resource.deps.size).toBe(1)
    expect(resource.dehydrate()).toBeUndefined()
    resource.dispose()
  })

  it('keeps a fresh passive cache and revalidates one stale passive read', async () => {
    const runtime = createRuntime()
    let now = 5
    let fetches = 0
    const scheduler = {
      now: () => now,
      schedule: () => ({ cancel: () => undefined })
    }
    const resource = new Resource(
      async () => {
        fetches++
        return 'fresh'
      },
      runtime,
      {
        autoStart: false,
        initialSnapshot: { version: 2, data: 'cached', ageMs: 0, remainingTtlMs: 10 },
        ttl: 10,
        scheduler
      }
    )

    expect(resource.state).toEqual({ status: 'success', data: 'cached' })
    expect(resource.isStale).toBe(false)
    expect(fetches).toBe(0)
    now = 15
    expect(resource.state.status).toBe('pending')
    await expect(resource.promise).resolves.toBe('fresh')
    expect(fetches).toBe(1)
    expect(resource.state).toEqual({ status: 'success', data: 'fresh' })
    resource.dispose()
  })
})
