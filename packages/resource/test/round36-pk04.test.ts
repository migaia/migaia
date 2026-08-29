import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { Resource } from '../src/index.js'
import { ResourceErrorCode } from '../src/error-code.js'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('PK-04 Resource policy and settlement contracts', () => {
  it('rejects a thenable retry predicate and observes its late rejection', async () => {
    const rejection = new Error('async retry predicate rejection')
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const resource = new Resource(
      async () => {
        throw new Error('initial failure')
      },
      runtime,
      { retry: () => Promise.reject(rejection) as never }
    )
    await expect(resource.promise).rejects.toMatchObject({
      source: '@migaia/resource',
      code: ResourceErrorCode.invalidOption
    })
    await flush()
    expect(reported).toEqual([rejection])
    resource.dispose()
  })

  it('reports a thenable retry delay rejection exactly once', async () => {
    const rejection = new Error('async retry delay rejection')
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const resource = new Resource(
      async () => {
        throw new Error('initial failure')
      },
      runtime,
      {
        retry: () => true,
        retryDelay: () => Promise.reject(rejection) as never
      }
    )
    await expect(resource.promise).rejects.toMatchObject({
      source: '@migaia/resource',
      code: ResourceErrorCode.invalidOption
    })
    await flush()
    expect(reported).toEqual([rejection])
    resource.dispose()
  })

  it('keeps a zero-TTL success observable until explicit refetch', async () => {
    const runtime = createRuntime()
    let fetches = 0
    const resource = new Resource(
      () => {
        fetches++
        return fetches
      },
      runtime,
      { autoStart: false, ttl: 0 }
    )
    await expect(resource.refetch()).resolves.toBe(1)
    expect(resource.state).toEqual({ status: 'success', data: 1 })
    expect(resource.fetchStatus).toBe('idle')
    expect(fetches).toBe(1)
    resource.dispose()
  })

  it('publishes settled state only after fetchStatus becomes idle', async () => {
    const runtime = createRuntime({ adapter: { scheduleMicrotask: (task) => task() } })
    let resolveFetch!: (value: string) => void
    const snapshots: Array<[string, string]> = []
    const resource = new Resource(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve
        }),
      runtime
    )
    const dispose = runtime.effect(() => {
      const state = resource.state
      snapshots.push([state.status, resource.fetchStatus])
    })
    resolveFetch('done')
    await flush()
    expect(snapshots).toContainEqual(['success', 'idle'])
    dispose()
    resource.dispose()
  })
})
