import { createRuntime } from '@migaia/reactive'
import { describe, expect, it } from 'vitest'
import { memoryBackendPlugin } from '../../src/plugins/memory.js'
import { memoryReactive } from '../../src/plugins/reactive/memory.js'
import { createStorageHost } from '../../src/host/index.js'
import { createStorageReactiveService } from '../../src/host/reactive.js'
import { getBackendReactiveController } from '../../src/backends/reactive-controller.js'
import { memoryStorageHost } from '../../src/backends/memory.js'

/** R12 proves the public Host capability projection and runtime guard remain exact. */
describe('SWV4-B05 R12 Host capability and computed state', () => {
  it('fixes the liveQuery slot at construction and fails closed without the service', async () => {
    const host = await createStorageHost()
    const descriptor = Object.getOwnPropertyDescriptor(host, 'liveQuery')
    expect(descriptor).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false
    })
    const liveQuery = Reflect.get(host, 'liveQuery') as (options: unknown) => unknown
    let failure: unknown
    try {
      liveQuery({
        backendId: 'missing',
        runtime: createRuntime(),
        query: () => 'never-started'
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      source: '@migaia/storage-web',
      code: 'REACTIVE_SERVICE_NOT_INSTALLED',
      message: 'reactive live-query service is not installed'
    })
    await host.dispose()
  })

  it('supports dynamic use after the facade is made non-extensible', async () => {
    const host = await createStorageHost()
    Object.preventExtensions(host)
    const plugins = [memoryBackendPlugin({ id: 'r12-dynamic-use' })] as const
    const installed = await host.use(...plugins)
    const installedBackends = installed.backends() as ReadonlyMap<string, unknown>
    const originalBackends = host.backends() as ReadonlyMap<string, unknown>
    expect(installedBackends.get('r12-dynamic-use')).toBe(originalBackends.get('r12-dynamic-use'))
    await host.dispose()
  })

  it('rejects forged consistency visibility before adapter publication', async () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)
    const service = createStorageReactiveService()
    expect(controller).toBeDefined()
    expect(() =>
      service.registerAdapter({
        backendId: 'r12-forged-consistency',
        store,
        controller: controller!,
        consistency: { mode: 'push', visibility: 'forged' as never },
        subscribe: undefined,
        report: () => undefined
      })
    ).toThrowError('reactive feature is invalid')
    await service.dispose()
    await store.dispose()
  })

  it('returns a frozen computed state bound to the exact reactive adapter store', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r12-reactive' })] as const
    })
    const store = host.backend('r12-reactive')
    const adapter = host.reactiveBackend('r12-reactive')
    expect(adapter?.store).toBe(store)
    const runtime = createRuntime()
    const query = host.liveQuery({
      backendId: 'r12-reactive',
      runtime,
      query: () => 'computed'
    })
    await query.ready
    const state = query.state
    expect(Object.isFrozen(state)).toBe(true)
    expect(state.runtime).toBe(runtime)
    expect(state.value).toMatchObject({ status: 'ready', value: 'computed' })
    expect(state.peek()).toBe(state.value)
    expect(state.observed).toBeTypeOf('boolean')
    expect(state).not.toHaveProperty('dispose')
    expect(query.consistency).toEqual({ mode: 'push', visibility: 'instance' })
    expect(Object.isFrozen(query.consistency)).toBe(true)
    expect('pollIntervalMs' in query.consistency).toBe(false)
    expect(Reflect.set(state, 'value', 'forged')).toBe(false)
    expect(query.state.value.value).toBe('computed')
    await query.dispose()
    expect(query.state.value).toMatchObject({ status: 'disposed', value: 'computed' })
    await host.dispose()
  })

  it('projects the exact Resource failure into the computed error state', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r12-error' })] as const
    })
    const runtime = createRuntime()
    const cause = new Error('r12 query failure')
    const query = host.liveQuery({
      backendId: 'r12-error',
      runtime,
      query: () => Promise.reject(cause)
    })
    const failure = await query.ready.catch((error: unknown) => error)
    expect(failure).toMatchObject({
      source: '@migaia/storage-web',
      code: 'EXTENSION_FAILED',
      cause
    })
    expect(query.state.value).toMatchObject({ status: 'error', error: failure })
    await query.dispose()
    expect(query.state.value).toMatchObject({ status: 'disposed', error: expect.anything() })
    await host.dispose()
  })

  it('exposes refreshing and ready projections while Resource keeps request ownership', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r12-refresh' })] as const
    })
    const runtime = createRuntime()
    let reads = 0
    let resolveRefresh!: (value: string) => void
    const pendingRefresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    const query = host.liveQuery({
      backendId: 'r12-refresh',
      runtime,
      query: () => (reads++ === 0 ? 'initial' : pendingRefresh)
    })
    await query.ready
    expect(query.state.value).toMatchObject({ status: 'ready', value: 'initial' })
    const refresh = query.refresh()
    await Promise.resolve()
    expect(query.state.value).toMatchObject({ status: 'refreshing', value: 'initial' })
    resolveRefresh('next')
    await refresh
    expect(query.state.value).toMatchObject({ status: 'ready', value: 'next' })
    await query.dispose()
    await host.dispose()
  })
})
