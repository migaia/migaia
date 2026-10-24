import { describe, expect, it, vi } from 'vitest'
import { createReactiveServiceFixture } from '../helpers/reactive-service.js'

/** Original source and Resource lifecycle behavior uses actual installed stores and controllers. */
describe('reactive source adapters', () => {
  it('seals an asynchronous source and releases active queries once', async () => {
    const { store, controller, service } = await createReactiveServiceFixture({
      id: 'source-fixture',
      attach: false
    })
    const reports: unknown[] = []
    let stopped = 0
    let observedSignal: { readonly aborted: boolean } | undefined
    const adapter = service.registerAdapter({
      backendId: 'late-source',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: ({ signal }) => {
        observedSignal = signal
        return Promise.resolve(() => {
          stopped += 1
        })
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

  it('reports sync admission failures as native coded TypeErrors with the original cause', async () => {
    const { store, controller, service } = await createReactiveServiceFixture({
      id: 'source-fixture',
      attach: false
    })
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

  it('invokes source stop and active query terminals in one synchronous ordered pass', async () => {
    const { store, controller, service } = await createReactiveServiceFixture({
      id: 'source-fixture',
      attach: false
    })
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
    const { store, controller, service } = await createReactiveServiceFixture({
      id: 'source-fixture',
      attach: false
    })
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
