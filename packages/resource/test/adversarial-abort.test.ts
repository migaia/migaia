import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { Resource } from '../src/index.ts'
import { ResourceErrorCode } from '../src/error-code.ts'

describe('SWR cancel state consistency', () => {
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

describe('withAbort signal registration race', () => {
  it('rejects when abort happens during add without replaying the callback, then removes once', async () => {
    const runtime = createRuntime()
    const storedListeners = new Set<() => void>()
    let aborted = false
    let addCalls = 0
    let removeCalls = 0
    const resource = new Resource(
      ({ signal }) => {
        Object.defineProperty(signal, 'aborted', { configurable: true, get: () => aborted })
        signal.addEventListener = (_type: string, listener: () => void) => {
          addCalls++
          aborted = true
          storedListeners.add(listener)
        }
        signal.removeEventListener = (_type: string, listener: () => void) => {
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
        signal.addEventListener = (_type: string, listener: () => void) => {
          addCalls++
          listener()
          storedListeners.add(listener)
        }
        signal.removeEventListener = (_type: string, listener: () => void) => {
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
        signal.addEventListener = (_type: string, listener: () => void) => {
          storedListeners.add(listener)
          throw registrationError
        }
        signal.removeEventListener = (_type: string, listener: () => void) => {
          removeCalls++
          storedListeners.delete(listener)
        }
        return Promise.resolve('unused')
      },
      runtime,
      { autoStart: false }
    )

    await expect(resource.refetch()).rejects.toMatchObject({
      source: 'resource',
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
        source: 'resource',
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
        source: 'resource',
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
        source: 'resource',
        code: ResourceErrorCode.cancellationCleanupFailed,
        cause: cleanupError
      })
    ])
    resource.dispose()
  })
})

describe('Resource dispose teardown convergence', () => {
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

    stop.dispose()
  })
})
