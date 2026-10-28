import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/testing'
import { Resource } from '../src/index.ts'
import { ResourceErrorCode } from '../src/error-code.ts'

/** Flushes pending microtasks and idle tasks before observing retry admission. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('resource scheduler injection', () => {
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

describe('retry timer cleanup failure', () => {
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
      expect.objectContaining({ source: 'resource', code: 'INVALID_OPTION' })
    )
    resource.dispose()
  })

  it('cancel converges state while reporting cleanup error through the runtime sink', async () => {
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
        source: 'resource',
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

describe('retry admission abort race', () => {
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
          signal.addEventListener = (_type: string, listener: () => void) => {
            addCalls++
            if (addCalls === 1) listener()
            storedListeners.add(listener)
          }
          signal.removeEventListener = (_type: string, listener: () => void) => {
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
        source: 'resource',
        code: ResourceErrorCode.cancellationCleanupFailed,
        cause: cleanupError
      })
    ])
    resource.dispose()
  })
})
