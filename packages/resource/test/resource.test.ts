import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus, ResourceFetchStatus } from '../src'

describe('resource foundation', () => {
  it('shares request state and settles successful fetches', async () => {
    const runtime = createRuntime()
    const resource = new Resource(async () => 42, runtime)

    expect(resource.state.status).toBe('pending')
    expect(resource.fetchStatus).toBe(ResourceFetchStatus.fetching)
    await expect(resource.promise).resolves.toBe(42)
    expect(resource.state).toEqual({ status: 'success', data: 42 })
    expect(resource.fetchStatus).toBe(ResourceFetchStatus.idle)

    resource.dispose()
  })

  it('keeps data status and fetch activity in separate public domains', () => {
    expect(Object.keys(ResourceStatus)).toEqual([
      'idle',
      'pending',
      'success',
      'error',
      'cancelled'
    ])
    expect(Object.keys(ResourceFetchStatus)).toEqual(['idle', 'fetching'])
    expect(ResourceStatus).not.toHaveProperty('fetching')
  })
})
