/* oxlint-disable unicorn/no-thenable -- 对抗夹具刻意构造 hostile then getter 以验证单次探测语义 */
import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createManualScheduler, LifecycleErrorCode } from '@migaia/lifecycle'
import { Resource } from '../src'
import { ResourceErrorCode } from '../src/error-code.js'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('AF-T6 resource scheduler injection', () => {
  it('retry delay is driven by the injected manual scheduler, not a host timer or microtask', async () => {
    const manual = createManualScheduler()
    const runtime = createRuntime()
    let attempts = 0
    const resource = new Resource(
      async () => {
        attempts += 1
        if (attempts === 1) throw new Error('first fail')
        return 'ok'
      },
      runtime,
      { retry: 1, retryDelay: 60_000, scheduler: manual }
    )
    const promise = resource.promise
    await flush()
    // 60s retry delay must NOT run immediately.
    expect(attempts).toBe(1)
    manual.advance(60_000)
    await expect(promise).resolves.toBe('ok')
    expect(attempts).toBe(2)
    resource.dispose()
  })

  it('passes Number.MAX_VALUE retry delay through as finite scheduler input without expiry arithmetic', async () => {
    const runtime = createRuntime()
    let attempts = 0
    let scheduledDelay = 0
    let scheduledCallback: (() => void) | undefined
    const scheduler = {
      now: () => 0,
      schedule(callback: () => void, delay: number) {
        scheduledCallback = callback
        scheduledDelay = delay
        return { cancel: () => undefined }
      }
    }
    const resource = new Resource(
      async () => {
        attempts += 1
        if (attempts === 1) throw new Error('first fail')
        return 'ok'
      },
      runtime,
      { retry: 1, retryDelay: Number.MAX_VALUE, scheduler }
    )

    const promise = resource.promise
    await flush()
    expect(scheduledDelay).toBe(Number.MAX_VALUE)
    expect(Number.isFinite(scheduledDelay)).toBe(true)
    scheduledCallback?.()
    await expect(promise).resolves.toBe('ok')
    resource.dispose()
  })
})

describe('Round21 resource TTL finite-domain admission', () => {
  it('rejects updatedAt plus finite ttl overflow before success or dehydration', async () => {
    const runtime = createRuntime()
    const resource = new Resource(async () => 'value', runtime, {
      ttl: Number.MAX_VALUE,
      scheduler: { now: () => Number.MAX_VALUE, schedule: () => ({ cancel: () => undefined }) }
    })

    await expect(resource.promise).rejects.toMatchObject({
      name: 'RangeError',
      source: '@migaia/resource',
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
      version: 1,
      data: 'value',
      updatedAt: halfMax,
      expiresAt: Number.MAX_VALUE
    })

    const hydrated = new Resource(async () => 'unused', runtime, {
      autoStart: false,
      initialSnapshot: resource.dehydrate(),
      scheduler: { now: () => 0, schedule: () => ({ cancel: () => undefined }) }
    })
    expect(hydrated.state).toEqual({ status: 'success', data: 'value' })
    expect(hydrated.dehydrate()?.expiresAt).toBe(Number.MAX_VALUE)
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

describe('AF-T7 SWR cancel state consistency', () => {
  it('cancel during a SWR refresh keeps stale data and clears refreshing', async () => {
    const runtime = createRuntime()
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockImplementationOnce(() => new Promise<string>(() => {}))
    const resource = new Resource(fetcher, runtime, { staleWhileRevalidate: true })
    await resource.promise
    expect(resource.state).toEqual({ status: 'success', data: 'first' })

    void resource.refetch()
    expect(resource.refreshing).toBe(true)
    expect(resource.fetchStatus).toBe('fetching')

    resource.cancel()
    expect(resource.refreshing).toBe(false)
    expect(resource.fetchStatus).toBe('idle')
    expect(resource.state).toEqual({ status: 'success', data: 'first' })
    resource.dispose()
  })
})

describe('AF-T8 Suspense throw then-getter probe', () => {
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

describe('AF-T21 resource scheduler entry validation', () => {
  it('hydrates from one snapshot read, preventing accessor TOCTOU', () => {
    const runtime = createRuntime()
    let reads = 0
    const snapshot = {
      version: 1,
      data: 'ok',
      get updatedAt() {
        reads++
        return reads === 1 ? 1 : Number.NaN
      },
      expiresAt: 10
    }
    const resource = new Resource(async () => 'fresh', runtime)
    resource.hydrate(snapshot as any)
    expect(reads).toBe(1)
    expect(resource.dehydrate()).toMatchObject({ updatedAt: 1, expiresAt: 10 })
    resource.dispose()
  })

  it('wraps snapshot accessor failures with INVALID_SNAPSHOT and cause', () => {
    const runtime = createRuntime()
    const cause = new Error('snapshot getter boom')
    const resource = new Resource(async () => 'fresh', runtime)
    expect(() =>
      resource.hydrate({
        version: 1,
        data: 'ok',
        get updatedAt(): number {
          throw cause
        },
        expiresAt: 10
      } as any)
    ).toThrowError(
      expect.objectContaining({
        source: '@migaia/resource',
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

  it('AF-T28: hostile scheduler getter is wrapped as INVALID_OPTION with the original as cause', () => {
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

  it('AF-T31: scheduler is read exactly once and the validated snapshot is used', () => {
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

describe('AF-T65 resource initialSnapshot construction admission', () => {
  it('reads initialSnapshot once and uses the first value for hydration and autostart', async () => {
    const runtime = createRuntime()
    const first = { version: 1 as const, data: 'first', updatedAt: 1, expiresAt: null }
    const second = { version: 1 as const, data: 'second', updatedAt: 1, expiresAt: null }
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
        source: '@migaia/resource',
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
      { initialSnapshot: { version: 1, data: 'cached', updatedAt: 1, expiresAt: null } }
    )

    await expect(resource.promise).resolves.toBe('cached')
    expect(fetches).toBe(0)
    resource.dispose()
  })
})

describe('AF-T64 retry timer cleanup failure', () => {
  it('rejects an invalid retry task without leaving the resource fetching forever', async () => {
    const runtime = createRuntime()
    const resource = new Resource(
      async () => {
        throw new Error('initial failure')
      },
      runtime,
      {
        retry: 1,
        retryDelay: 10,
        scheduler: { now: () => 0, schedule: () => ({}) } as any
      }
    )
    const request = resource.promise
    let settled = false
    let rejection: unknown
    void request.catch((error: unknown) => {
      settled = true
      rejection = error
    })

    await flush()

    expect(settled).toBe(true)
    expect(resource.fetchStatus).toBe('idle')
    expect(rejection).toEqual(
      expect.objectContaining({ source: '@migaia/resource', code: 'INVALID_OPTION' })
    )
    resource.dispose()
  })

  it('AF-T64: cancel converges state while reporting cleanup error through the runtime sink', async () => {
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const cleanupError = new Error('retry timer cleanup failed')
    const resource = new Resource(
      async () => {
        throw new Error('initial failure')
      },
      runtime,
      {
        retry: 1,
        retryDelay: 10,
        scheduler: {
          now: () => 0,
          schedule: () => ({
            cancel: () => {
              throw cleanupError
            }
          })
        }
      }
    )
    const request = resource.promise
    let requestSettled = false
    void request
      .catch(() => undefined)
      .then(() => {
        requestSettled = true
      })
    await flush()
    expect(resource.fetchStatus).toBe('fetching')

    let thrown: unknown
    try {
      resource.cancel()
    } catch (error) {
      thrown = error
    }
    await flush()

    expect(resource.fetchStatus).toBe('idle')
    expect(resource.state.status).toBe('cancelled')
    expect(requestSettled).toBe(true)
    expect(thrown).toBeUndefined()
    expect(reported).toEqual([
      expect.objectContaining({
        source: '@migaia/resource',
        code: ResourceErrorCode.cancellationCleanupFailed,
        cause: cleanupError
      })
    ])
    expect(resource.state).toEqual({
      status: 'cancelled',
      error: expect.objectContaining({
        name: 'AbortError',
        code: ResourceErrorCode.requestCancelled
      })
    })
    resource.dispose()
  })
})

describe('AF-T75 retry admission abort race', () => {
  it('removes a retry listener stored after its synchronous abort callback returns', async () => {
    const runtime = createRuntime()
    const storedListeners = new Set<() => void>()
    let addCalls = 0
    let removeCalls = 0
    let scheduleCalls = 0
    let attempts = 0
    const scheduler = {
      now: () => 0,
      schedule: () => {
        scheduleCalls++
        return { cancel: () => {} }
      }
    }
    const resource = new Resource(
      ({ signal }) => {
        attempts++
        if (attempts === 1) {
          signal.addEventListener = (_type, listener) => {
            addCalls++
            if (addCalls === 1) listener()
            storedListeners.add(listener)
          }
          signal.removeEventListener = (_type, listener) => {
            removeCalls++
            storedListeners.delete(listener)
          }
          throw new Error('initial failure')
        }
        return 'unexpected retry'
      },
      runtime,
      { autoStart: false, retry: 1, retryDelay: 10, scheduler }
    )
    const request = resource.refetch()

    await expect(request).rejects.toMatchObject({
      name: 'AbortError',
      code: ResourceErrorCode.requestAborted
    })
    await flush()

    expect(attempts).toBe(1)
    expect(scheduleCalls).toBe(0)
    expect(addCalls).toBe(2)
    expect(removeCalls).toBeGreaterThanOrEqual(2)
    expect(storedListeners.size).toBe(0)
    expect(resource.state).toEqual({
      status: 'error',
      error: expect.objectContaining({
        name: 'AbortError',
        code: ResourceErrorCode.requestAborted
      })
    })
    resource.dispose()
  })

  it('lets abort win when schedule aborts before returning a task and cancels the returned task', async () => {
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    let resource!: Resource<number>
    let attempts = 0
    let taskCancels = 0
    let scheduledCallback: (() => void) | undefined
    const scheduler = {
      now: () => 0,
      schedule: (callback: () => void) => {
        scheduledCallback = callback
        resource.cancel()
        return {
          cancel: () => {
            taskCancels++
          }
        }
      }
    }
    resource = new Resource(
      async () => {
        attempts++
        if (attempts === 1) throw new Error('initial failure')
        return 2
      },
      runtime,
      { retry: 1, retryDelay: 10, scheduler }
    )
    const request = resource.promise

    await expect(request).rejects.toMatchObject({
      name: 'AbortError',
      code: ResourceErrorCode.requestAborted
    })
    await flush()

    expect(attempts).toBe(1)
    expect(taskCancels).toBe(1)
    expect(resource.fetchStatus).toBe('idle')
    expect(resource.state).toEqual({
      status: 'cancelled',
      error: expect.objectContaining({
        name: 'AbortError',
        code: ResourceErrorCode.requestCancelled
      })
    })
    expect(reported).toEqual([])

    // A hostile scheduler may still invoke a cancelled callback; it must not restart the fetcher.
    scheduledCallback?.()
    await flush()
    expect(attempts).toBe(1)
    resource.dispose()
  })

  it('keeps AbortError primary while reporting returned-task cleanup failure', async () => {
    const cleanupError = new Error('returned retry task cancel failed')
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    let resource!: Resource<number>
    let attempts = 0
    let taskCancels = 0
    const scheduler = {
      now: () => 0,
      schedule: () => {
        resource.cancel()
        return {
          cancel: () => {
            taskCancels++
            throw cleanupError
          }
        }
      }
    }
    resource = new Resource(
      async () => {
        attempts++
        throw new Error('initial failure')
      },
      runtime,
      { retry: 1, retryDelay: 10, scheduler }
    )
    const request = resource.promise

    await expect(request).rejects.toMatchObject({
      name: 'AbortError',
      code: ResourceErrorCode.requestAborted
    })
    await flush()

    expect(attempts).toBe(1)
    expect(taskCancels).toBe(1)
    expect(reported).toEqual([
      expect.objectContaining({
        source: '@migaia/resource',
        code: ResourceErrorCode.cancellationCleanupFailed,
        cause: cleanupError
      })
    ])
    resource.dispose()
  })
})

describe('AF-T85 withAbort signal registration race', () => {
  it('rejects when abort happens during add without replaying the callback, then removes once', async () => {
    const runtime = createRuntime()
    const storedListeners = new Set<() => void>()
    let aborted = false
    let addCalls = 0
    let removeCalls = 0
    const resource = new Resource(
      ({ signal }) => {
        Object.defineProperty(signal, 'aborted', { configurable: true, get: () => aborted })
        signal.addEventListener = (_type, listener) => {
          addCalls++
          aborted = true
          storedListeners.add(listener)
        }
        signal.removeEventListener = (_type, listener) => {
          removeCalls++
          storedListeners.delete(listener)
        }
        return new Promise<string>(() => {})
      },
      runtime,
      { autoStart: false }
    )

    const request = resource.refetch()
    await expect(request).rejects.toMatchObject({
      name: 'AbortError',
      code: ResourceErrorCode.requestAborted
    })

    expect(aborted).toBe(true)
    expect(addCalls).toBe(1)
    expect(removeCalls).toBe(1)
    expect(storedListeners.size).toBe(0)
    resource.dispose()
  })

  it('removes after an abort callback runs before add stores the listener', async () => {
    const runtime = createRuntime()
    const storedListeners = new Set<() => void>()
    let addCalls = 0
    let removeCalls = 0
    const resource = new Resource(
      ({ signal }) => {
        signal.addEventListener = (_type, listener) => {
          addCalls++
          listener()
          storedListeners.add(listener)
        }
        signal.removeEventListener = (_type, listener) => {
          removeCalls++
          storedListeners.delete(listener)
        }
        return new Promise<string>(() => {})
      },
      runtime,
      { autoStart: false }
    )

    await expect(resource.refetch()).rejects.toMatchObject({
      name: 'AbortError',
      code: ResourceErrorCode.requestAborted
    })
    expect(addCalls).toBe(1)
    expect(removeCalls).toBe(2)
    expect(storedListeners.size).toBe(0)
    resource.dispose()
  })

  it('wraps add failure with a package error and cause, while rolling back a stored listener', async () => {
    const runtime = createRuntime()
    const registrationError = new Error('abort listener registration failed')
    const storedListeners = new Set<() => void>()
    let removeCalls = 0
    const resource = new Resource(
      ({ signal }) => {
        signal.addEventListener = (_type, listener) => {
          storedListeners.add(listener)
          throw registrationError
        }
        signal.removeEventListener = (_type, listener) => {
          removeCalls++
          storedListeners.delete(listener)
        }
        return Promise.resolve('unused')
      },
      runtime,
      { autoStart: false }
    )

    await expect(resource.refetch()).rejects.toMatchObject({
      source: '@migaia/resource',
      code: ResourceErrorCode.invalidOption,
      cause: registrationError
    })
    expect(removeCalls).toBe(1)
    expect(storedListeners.size).toBe(0)
    resource.dispose()
  })

  it('reports remove failure without replacing source success', async () => {
    const cleanupError = new Error('abort listener removal failed')
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const resource = new Resource(
      ({ signal }) => {
        signal.removeEventListener = () => {
          throw cleanupError
        }
        return Promise.resolve('ok')
      },
      runtime,
      { autoStart: false }
    )

    await expect(resource.refetch()).resolves.toBe('ok')
    expect(reported).toEqual([
      expect.objectContaining({
        source: '@migaia/resource',
        code: ResourceErrorCode.cancellationCleanupFailed,
        cause: cleanupError
      })
    ])
    resource.dispose()
  })

  it('reports remove failure without replacing source error', async () => {
    const sourceError = new Error('source failed')
    const cleanupError = new Error('abort listener removal failed')
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const resource = new Resource(
      ({ signal }) => {
        signal.removeEventListener = () => {
          throw cleanupError
        }
        return Promise.reject(sourceError)
      },
      runtime,
      { autoStart: false }
    )

    await expect(resource.refetch()).rejects.toBe(sourceError)
    expect(reported).toEqual([
      expect.objectContaining({
        source: '@migaia/resource',
        code: ResourceErrorCode.cancellationCleanupFailed,
        cause: cleanupError
      })
    ])
    resource.dispose()
  })

  it('reports remove failure without replacing AbortError cancellation', async () => {
    const cleanupError = new Error('abort listener removal failed')
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const resource = new Resource(
      ({ signal }) => {
        signal.removeEventListener = () => {
          throw cleanupError
        }
        return new Promise<string>(() => {})
      },
      runtime,
      { autoStart: false }
    )
    const request = resource.refetch()

    resource.cancel()
    await expect(request).rejects.toMatchObject({
      name: 'AbortError',
      code: ResourceErrorCode.requestAborted
    })
    expect(reported).toEqual([
      expect.objectContaining({
        source: '@migaia/resource',
        code: ResourceErrorCode.cancellationCleanupFailed,
        cause: cleanupError
      })
    ])
    resource.dispose()
  })
})

describe('AF-T86 Resource dispose teardown convergence', () => {
  it('completes teardown when an active fetch signal listener is notified', () => {
    const runtime = createRuntime()
    const dependency = runtime.signal(1)
    let abortNotified = false
    const resource = new Resource(
      ({ signal }) => {
        void dependency.value
        signal.addEventListener('abort', () => {
          abortNotified = true
        })
        return new Promise<string>(() => {})
      },
      runtime,
      { autoStart: false, keepAlive: true }
    )
    const request = resource.refetch()
    void request.catch(() => undefined)
    const stop = runtime.effect(() => {
      void resource.state
    })

    expect(resource.state).toEqual({ status: 'pending' })
    expect(resource.deps.size).toBe(1)
    expect(resource.observed).toBe(true)

    expect(() => resource.dispose()).not.toThrow()
    expect(abortNotified).toBe(true)
    expect(resource.disposed).toBe(true)
    expect(resource.deps.size).toBe(0)
    expect(resource.observed).toBe(false)
    expect(() => resource.state).toThrowError(
      expect.objectContaining({ code: ResourceErrorCode.resourceDisposed })
    )
    expect(() => resource.dispose()).not.toThrow()
    expect(resource.disposed).toBe(true)

    stop()
  })
})

describe('Round29 Resource scheduler.now boundary', () => {
  it('R-T29-01 wraps a scheduler.now throw during successful settlement and publishes no success/cache', async () => {
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
      source: '@migaia/resource',
      code: ResourceErrorCode.invalidOption,
      message: 'resource scheduler task operation failed',
      cause: clockError
    })
    expect(resource.state).toEqual({ status: 'error', error: rejection })
    expect(resource.dehydrate()).toBeUndefined()
    resource.dispose()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'R-T29-02 wraps scheduler.now()=%s validation with Resource ownership and preserves native cause',
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
        source: '@migaia/resource',
        code: ResourceErrorCode.invalidOption,
        message: 'resource scheduler task operation failed'
      })
      expect(cause).toMatchObject({
        source: '@migaia/lifecycle',
        code: LifecycleErrorCode.invalidOption
      })
      expect(cause).toBeInstanceOf(RangeError)
      expect(resource.state).toEqual({ status: 'error', error: rejection })
      expect(resource.dehydrate()).toBeUndefined()
      resource.dispose()
    }
  )

  it('R-T29-03 makes repeated passive freshness reads fail closed with one wrapper, stable promise, atomic cache metadata, and reporter identity', async () => {
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    let nowCalls = 0
    const clockError = new Error('passive clock failed')
    const scheduler = {
      now: () => {
        nowCalls++
        throw clockError
      },
      schedule: () => ({ cancel: () => undefined })
    }
    const snapshot = { version: 1 as const, data: 'cached', updatedAt: 1, expiresAt: 10 }
    const resource = new Resource(async () => 'unused', runtime, {
      autoStart: false,
      initialSnapshot: snapshot,
      scheduler
    })

    expect(resource.dehydrate()).toEqual(snapshot)
    const state = resource.state
    expect(state.status).toBe('error')
    const failure = (state as { status: 'error'; error: unknown }).error
    expect(failure).toMatchObject({
      source: '@migaia/resource',
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

  it('R-T29-04 preserves the retry boundary when the retried success settlement clock fails', async () => {
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
      source: '@migaia/resource',
      code: ResourceErrorCode.invalidOption,
      cause: clockError
    })
    resource.dispose()
  })

  it('R-T29-05 SWR/keepAlive success settlement clock failure keeps refresh atomic and does not suspend dependencies', async () => {
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
      source: '@migaia/resource',
      code: ResourceErrorCode.invalidOption,
      cause: clockError
    })
    expect(resource.state).toEqual({ status: 'error', error: rejection })
    expect(resource.deps.size).toBe(1)
    expect(resource.dehydrate()).toBeUndefined()
    resource.dispose()
  })

  it('R-T29-06 keeps a fresh passive cache and revalidates one stale passive read', async () => {
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
        initialSnapshot: { version: 1, data: 'cached', updatedAt: 0, expiresAt: 10 },
        ttl: 10,
        scheduler
      }
    )

    expect(resource.state).toEqual({ status: 'success', data: 'cached' })
    expect(resource.isStale).toBe(false)
    expect(fetches).toBe(0)
    now = 10
    expect(resource.state.status).toBe('pending')
    await expect(resource.promise).resolves.toBe('fresh')
    expect(fetches).toBe(1)
    expect(resource.state).toEqual({ status: 'success', data: 'fresh' })
    resource.dispose()
  })
})
