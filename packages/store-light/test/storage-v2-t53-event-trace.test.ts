import { describe, expect, it, vi } from 'vitest'
import { createStoreResource } from '../src/store-resource.js'

/** Creates one externally settled load used to force exact notification timing. */
const deferred = <T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('SWV2-T53 store-light event-subscriber traces', () => {
  it('preserves recursive nested notification order through the consumer facade', async () => {
    const firstLoad = deferred<object>()
    const secondLoad = deferred<object>()
    let loadCount = 0
    const resource = createStoreResource(() =>
      loadCount++ === 0 ? firstLoad.promise : secondLoad.promise
    )
    const trace: string[] = []
    let nested = false
    const stopFirst = resource.subscribe(() => {
      trace.push(`first:${resource.getSnapshot()}`)
      if (nested) return
      nested = true
      resource.retry()
    })
    const stopSecond = resource.subscribe(() => {
      trace.push(`second:${resource.getSnapshot()}`)
    })

    resource.preload()
    firstLoad.resolve({ value: 1 })
    await vi.waitFor(() => expect(trace).toHaveLength(4))

    expect(trace).toEqual(['first:1', 'first:2', 'second:2', 'second:2'])
    stopFirst()
    stopSecond()
    secondLoad.resolve({ value: 2 })
    await Promise.resolve()
    resource.forceDispose()
  })

  it('keeps the current snapshot when a listener removes and adds listeners during dispatch', () => {
    const resource = createStoreResource(() => ({ value: 1 }))
    const trace: string[] = []
    let stopSecond = (): void => undefined
    resource.subscribe(() => {
      trace.push('first')
      stopSecond()
      resource.subscribe(() => trace.push('added'))
    })
    stopSecond = resource.subscribe(() => trace.push('second'))

    resource.dispose()

    expect(trace).toEqual(['first', 'second'])
  })

  it('contains sync throw and async rejection while preserving healthy listener order', async () => {
    const syncFailure = new Error('sync listener failure')
    const asyncFailure = new Error('async listener failure')
    const reports: unknown[] = []
    const trace: string[] = []
    const resource = createStoreResource(() => ({ value: 1 }), {
      onError: (error, phase) => reports.push([error, phase])
    })
    resource.subscribe(() => {
      trace.push('sync-failure')
      throw syncFailure
    })
    resource.subscribe((() => {
      trace.push('async-failure')
      return Promise.reject(asyncFailure)
    }) as () => void)
    resource.subscribe(() => trace.push('healthy'))

    expect(() => resource.dispose()).not.toThrow()
    await vi.waitFor(() => expect(reports).toHaveLength(2))

    expect(trace).toEqual(['sync-failure', 'async-failure', 'healthy'])
    expect(reports).toEqual([
      [syncFailure, 'listener'],
      [asyncFailure, 'listener']
    ])
  })
})
