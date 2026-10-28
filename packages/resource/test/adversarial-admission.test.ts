import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { Resource } from '../src/index.ts'
import { ResourceErrorCode } from '../src/error-code.ts'

describe('resource TTL finite-domain admission', () => {
  it('rejects ageMs plus finite ttl overflow before success or dehydration', async () => {
    const runtime = createRuntime()
    const resource = new Resource(async () => 'value', runtime, {
      ttl: Number.MAX_VALUE,
      scheduler: { now: () => Number.MAX_VALUE, schedule: () => ({ cancel: () => undefined }) }
    })

    await expect(resource.promise).rejects.toMatchObject({
      name: 'RangeError',
      source: 'resource',
      code: ResourceErrorCode.invalidOption,
      message: 'resource ttl expiration must remain finite'
    })
    expect(resource.state.status).toBe('error')
    expect(resource.dehydrate()).toBeUndefined()
    resource.dispose()
  })

  it('accepts an exact finite boundary and preserves it through dehydrate/hydrate', async () => {
    const runtime = createRuntime()
    const halfMax = Number.MAX_VALUE / 2
    const scheduler = { now: () => halfMax, schedule: () => ({ cancel: () => undefined }) }
    const resource = new Resource(async () => 'value', runtime, { ttl: halfMax, scheduler })

    await expect(resource.promise).resolves.toBe('value')
    expect(resource.dehydrate()).toEqual({
      version: 2,
      data: 'value',
      ageMs: 0,
      remainingTtlMs: halfMax
    })

    const hydrated = new Resource(async () => 'unused', runtime, {
      autoStart: false,
      initialSnapshot: resource.dehydrate(),
      scheduler: { now: () => 0, schedule: () => ({ cancel: () => undefined }) }
    })
    expect(hydrated.state).toEqual({ status: 'success', data: 'value' })
    expect(hydrated.dehydrate()?.remainingTtlMs).toBe(halfMax)
    resource.dispose()
    hydrated.dispose()
  })

  it('does not leave stale SWR success/cache after a refresh expiry overflow', async () => {
    const runtime = createRuntime()
    let now = 0
    let fetchCount = 0
    const scheduler = {
      now: () => now,
      schedule: () => ({ cancel: () => undefined })
    }
    const resource = new Resource(
      async () => {
        fetchCount += 1
        return fetchCount
      },
      runtime,
      { ttl: Number.MAX_VALUE, staleWhileRevalidate: true, scheduler }
    )

    await expect(resource.promise).resolves.toBe(1)
    now = Number.MAX_VALUE
    await expect(resource.refetch()).rejects.toMatchObject({
      code: ResourceErrorCode.invalidOption,
      message: 'resource ttl expiration must remain finite'
    })
    expect(resource.state.status).toBe('error')
    expect(resource.dehydrate()).toBeUndefined()
    resource.dispose()
  })
})

describe('resource scheduler entry validation', () => {
  it('hydrates from one snapshot read, preventing accessor TOCTOU', () => {
    const runtime = createRuntime()
    let reads = 0
    const snapshot = {
      version: 2,
      data: 'ok',
      get ageMs() {
        reads++
        return reads === 1 ? 1 : Number.NaN
      },
      remainingTtlMs: 10
    }
    const resource = new Resource(async () => 'fresh', runtime, {
      scheduler: { now: () => 0, schedule: () => ({ cancel: () => undefined }) }
    })
    resource.hydrate(snapshot as any)
    expect(reads).toBe(1)
    expect(resource.dehydrate()).toMatchObject({ ageMs: 1, remainingTtlMs: 10 })
    resource.dispose()
  })

  it('wraps snapshot accessor failures with INVALID_SNAPSHOT and cause', () => {
    const runtime = createRuntime()
    const cause = new Error('snapshot getter boom')
    const resource = new Resource(async () => 'fresh', runtime)
    expect(() =>
      resource.hydrate({
        version: 2,
        data: 'ok',
        get ageMs(): number {
          throw cause
        },
        remainingTtlMs: 10
      } as any)
    ).toThrowError(
      expect.objectContaining({
        source: 'resource',
        code: 'INVALID_SNAPSHOT',
        cause
      })
    )
    resource.dispose()
  })

  it('a scheduler missing now/schedule is rejected with INVALID_OPTION at construction', () => {
    const runtime = createRuntime()
    expect(() => new Resource(async () => 1, runtime, { scheduler: {} as any })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    expect(() => new Resource(async () => 1, runtime, { scheduler: { now: 'x' } as any })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
  })

  it('hostile scheduler getter is wrapped as INVALID_OPTION with the original as cause', () => {
    const runtime = createRuntime()
    const getterError = new Error('scheduler getter boom')
    const scheduler = new Proxy(
      {},
      {
        get() {
          throw getterError
        }
      }
    )
    let caught: unknown
    try {
      new Resource(async () => 1, runtime, { scheduler: scheduler as any })
    } catch (error) {
      caught = error
    }
    expect((caught as { code?: string }).code).toBe('INVALID_OPTION')
    expect((caught as { cause?: unknown }).cause).toBe(getterError)
  })

  it('scheduler is read exactly once and the validated snapshot is used', () => {
    const runtime = createRuntime()
    let reads = 0
    const scheduler = { now: () => 0, schedule: () => ({ cancel: () => {} }) }
    const options = {
      get scheduler() {
        reads += 1
        return scheduler
      }
    }
    new Resource(async () => 1, runtime, options as any)
    expect(reads).toBe(1)
  })
})

describe('resource initialSnapshot construction admission', () => {
  it('reads initialSnapshot once and uses the first value for hydration and autostart', async () => {
    const runtime = createRuntime()
    const first = { version: 2 as const, data: 'first', ageMs: 1, remainingTtlMs: null }
    const second = { version: 2 as const, data: 'second', ageMs: 1, remainingTtlMs: null }
    let reads = 0
    let fetches = 0
    const resource = new Resource(
      async () => {
        fetches++
        return 'fetched'
      },
      runtime,
      {
        get initialSnapshot() {
          reads++
          return reads === 1 ? first : second
        }
      }
    )

    await expect(resource.promise).resolves.toBe('first')
    expect(reads).toBe(1)
    expect(fetches).toBe(0)
    expect(resource.state).toEqual({ status: 'success', data: 'first' })
    resource.dispose()
  })

  it('fails before fetcher, scheduler, dependency, or listener admission when initialSnapshot getter throws', () => {
    const runtime = createRuntime()
    const cause = new Error('initial snapshot getter boom')
    let fetches = 0
    let scheduleCalls = 0
    const scheduler = {
      now: () => 0,
      schedule: () => {
        scheduleCalls++
        return { cancel: () => {} }
      }
    }

    expect(
      () =>
        new Resource(
          () => {
            fetches++
            return 'unexpected'
          },
          runtime,
          {
            scheduler,
            get initialSnapshot(): undefined {
              throw cause
            }
          }
        )
    ).toThrowError(
      expect.objectContaining({
        source: 'resource',
        code: ResourceErrorCode.invalidOption,
        cause
      })
    )
    expect(fetches).toBe(0)
    expect(scheduleCalls).toBe(0)
  })

  it('treats an explicitly undefined initialSnapshot as absent and reads it once', () => {
    const runtime = createRuntime()
    let reads = 0
    let fetches = 0
    const resource = new Resource(
      () => {
        fetches++
        return 'value'
      },
      runtime,
      {
        autoStart: false,
        get initialSnapshot() {
          reads++
          return undefined
        }
      }
    )

    expect(reads).toBe(1)
    expect(fetches).toBe(0)
    expect(resource.fetchStatus).toBe('idle')
    resource.dispose()
  })

  it('hydrates a fresh initial snapshot without auto-fetching', async () => {
    const runtime = createRuntime()
    let fetches = 0
    const resource = new Resource(
      async () => {
        fetches++
        return 'fetched'
      },
      runtime,
      { initialSnapshot: { version: 2, data: 'cached', ageMs: 1, remainingTtlMs: null } }
    )

    await expect(resource.promise).resolves.toBe('cached')
    expect(fetches).toBe(0)
    resource.dispose()
  })
})
