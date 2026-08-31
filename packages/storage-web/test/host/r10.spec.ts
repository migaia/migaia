import { describe, expect, it, vi } from 'vitest'
import { createStorageHost } from '../../src/host/index.js'
import { memoryReactive } from '../../src/plugins/reactive/memory.js'
import { localStorageReactive } from '../../src/plugins/reactive/local-storage.js'
import { sessionStorageReactive } from '../../src/plugins/reactive/session-storage.js'
import { cookiesReactive } from '../../src/plugins/reactive/cookies.js'
import { indexedDbReactive } from '../../src/plugins/reactive/indexed-db.js'
import { createStorageReactiveService } from '../../src/host/reactive.js'
import { getBackendReactiveController } from '../../src/backends/reactive-controller.js'
import { memoryStorage } from '../../src/backends/memory.js'

/** R10 proves the Host installs one exact adapter for each canonical fast-path plugin. */
describe('SWV4-B05 R10 reactive adapters', () => {
  it('publishes exact memory identity and reactive capability after the atomic batch', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'reactive-memory' })] as const
    })
    const store = host.backend('reactive-memory')
    expect(host.hasReactiveBackend('reactive-memory')).toBe(true)
    expect(host.reactiveBackend('reactive-memory')).toMatchObject({
      id: 'reactive-memory',
      store
    })
    await host.dispose()
  })

  it('reuses the Host service for a later adapter batch without changing caller order', async () => {
    const host = await createStorageHost()
    await host.use(memoryReactive({ id: 'one' }))
    await host.use(memoryReactive({ id: 'two' }))
    expect(host.hasReactiveBackend('one')).toBe(true)
    expect(host.hasReactiveBackend('two')).toBe(true)
    expect([...host.backends().keys()]).toEqual(['one', 'two'])
    await host.dispose()
  })

  it('exposes the five canonical fast-path factories without aliases', () => {
    expect(typeof memoryReactive).toBe('function')
    expect(typeof localStorageReactive).toBe('function')
    expect(typeof sessionStorageReactive).toBe('function')
    expect(typeof cookiesReactive).toBe('function')
    expect(typeof indexedDbReactive).toBe('function')
  })

  it('seals a hostile thenable source without awaiting it and releases active queries once', async () => {
    const store = memoryStorage()
    const controller = getBackendReactiveController(store)!
    const service = createStorageReactiveService()
    const reports: unknown[] = []
    let stopped = 0
    let observedSignal: { readonly aborted: boolean } | undefined
    const adapter = service.registerAdapter({
      backendId: 'hostile',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: ({ signal }) => {
        observedSignal = signal
        const hostile = Object.create(null) as PromiseLike<unknown>
        const thenKey = ['t', 'h', 'e', 'n'].join('')
        Object.defineProperty(hostile, thenKey, {
          value: (resolve: (value: () => void) => void) => {
            resolve(() => {
              stopped += 1
            })
          }
        })
        return hostile
      },
      report: (error) => reports.push(error)
    })
    const query = adapter.acquireQuery()
    expect(() => adapter.startSource()).toThrowError('reactive feature is invalid')
    expect(observedSignal?.aborted).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(stopped).toBe(1)
    const firstDispose = adapter.dispose()
    expect(adapter.dispose()).toBe(firstDispose)
    query.release()
    await firstDispose
    expect(reports).toHaveLength(0)
    await service.dispose()
  })

  it('reports D79 sync admission failures as native coded TypeErrors with the original cause', () => {
    const store = memoryStorage()
    const controller = getBackendReactiveController(store)!
    const service = createStorageReactiveService()
    const cause = new Error('source admission failed')
    const adapter = service.registerAdapter({
      backendId: 'coded-admission',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: () => {
        throw cause
      },
      report: () => undefined
    })

    let failure: unknown
    try {
      adapter.startSource()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({
      source: '@migaia/storage-web',
      code: 'REACTIVE_FEATURE_INVALID',
      message: 'reactive feature is invalid',
      cause
    })
    expect((failure as Error).stack).toContain('TypeError')
  })

  it('rejects a service adapter whose store/controller pair is not the private registry pair', () => {
    const store = memoryStorage()
    const service = createStorageReactiveService()
    const controller = getBackendReactiveController(store)!
    const forgedController = { ...controller }
    expect(() =>
      service.registerAdapter({
        backendId: 'forged-provider',
        store,
        controller: forgedController,
        consistency: { mode: 'push', visibility: 'instance' },
        subscribe: undefined,
        report: () => undefined
      })
    ).toThrowError('reactive feature is invalid')
    expect(controller).toBe(getBackendReactiveController(store))
  })

  it('invokes source stop and active query terminals in one synchronous ordered pass', async () => {
    const store = memoryStorage()
    const controller = getBackendReactiveController(store)!
    const service = createStorageReactiveService()
    const order: string[] = []
    const reports: unknown[] = []
    const adapter = service.registerAdapter({
      backendId: 'terminal-order',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: () => () => {
        order.push('source-stop')
        return Promise.reject(new Error('source-stop-failed'))
      },
      report: (error) => reports.push(error)
    })
    const first = new Error('first-query-failed')
    const second = new Error('second-query-failed')
    const firstQuery = adapter.acquireQuery(() => {
      order.push('query-1')
      return Promise.reject(first)
    })
    const secondQuery = adapter.acquireQuery(() => {
      order.push('query-2')
      return Promise.reject(second)
    })
    adapter.startSource()

    const disposal = adapter.dispose()
    expect(adapter.dispose()).toBe(disposal)
    expect(order).toEqual(['source-stop', 'query-1', 'query-2'])
    expect(firstQuery.terminate()).toBe(firstQuery.terminate())
    expect(secondQuery.terminate()).toBe(secondQuery.terminate())
    await disposal
    expect(reports).toHaveLength(3)
    expect(reports[0]).toBeInstanceOf(Error)
    expect(reports[1]).toBeInstanceOf(AggregateError)
    expect(reports[2]).toBeInstanceOf(AggregateError)
    expect((reports[1] as AggregateError).errors).toEqual([first])
    expect((reports[2] as AggregateError).errors).toEqual([second])
    await service.dispose()
  })

  it('contains source-stop rejection even when the reporter itself throws', async () => {
    const store = memoryStorage()
    const controller = getBackendReactiveController(store)!
    const service = createStorageReactiveService()
    const adapter = service.registerAdapter({
      backendId: 'reporter-failure',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: () => () => Promise.reject(new Error('source-stop-failed')),
      report: () => {
        throw new Error('reporter-failed')
      }
    })
    adapter.startSource()
    const fallback = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(adapter.dispose()).resolves.toBeUndefined()
      expect(fallback).toHaveBeenCalledWith(
        '[storage-web] operation reporter failed',
        expect.objectContaining({ message: 'reporter-failed' })
      )
      await service.dispose()
    } finally {
      fallback.mockRestore()
    }
  })
})
