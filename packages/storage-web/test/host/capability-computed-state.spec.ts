import { memoryTestFeatures } from '../helpers/memory-features.js'
import { createRuntime } from '@migaia/reactive'
import { describe, expect, it } from 'vitest'
import { createStorageHost, memoryBackendKind, memoryBackendPlugin } from '@migaia/storage-host'
import { createStorageReactiveService } from '../../src/host/reactive.js'
import { createReactiveServiceFixture } from '../helpers/reactive-service.js'
import { reactiveFeature } from '../../src/features/reactive.js'
import { records } from '@migaia/storage-contract'

/** Proves the public Host capability projection and runtime guard remain exact. */
describe('Host capability and computed state', () => {
  it('adds live only to actual query chains selected by the reactive Feature', async () => {
    const plain = await createStorageHost({
      plugins: [memoryBackendPlugin({}, memoryTestFeatures)]
    })
    expect(plain).not.toHaveProperty('liveQuery')
    expect(plain.backend('memory').use(records).query()).not.toHaveProperty('live')
    await plain.dispose()
    const host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          ...memoryTestFeatures,
          reactive: reactiveFeature(memoryBackendKind)
        })
      ]
    })
    const query = host.backend('memory').use(records).query().live({ runtime: createRuntime() })
    await query.ready
    expect(query.state.value).toMatchObject({ status: 'ready', value: [] })
    await query.dispose()
    await host.dispose()
  })

  it('supports dynamic use after the facade is made non-extensible', async () => {
    const host = await createStorageHost()
    Object.preventExtensions(host)
    const plugins = [memoryBackendPlugin({ id: 'dynamic-use' }, memoryTestFeatures)] as const
    const installed = await host.use(...plugins)
    const installedBackends = installed.backends() as ReadonlyMap<string, unknown>
    const originalBackends = host.backends() as ReadonlyMap<string, unknown>
    expect(installedBackends.get('dynamic-use')).toBe(originalBackends.get('dynamic-use'))
    await host.dispose()
  })

  it('rejects forged consistency visibility before adapter publication', async () => {
    const { store, controller } = await createReactiveServiceFixture({
      id: 'forged-consistency-owner'
    })
    const service = createStorageReactiveService()
    expect(controller).toBeDefined()
    expect(() =>
      service.registerAdapter({
        backendId: 'forged-consistency',
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
    const { host, service } = await createReactiveServiceFixture({ id: 'fixture-reactive' })
    const store = host.backend('memory')
    const runtime = createRuntime()
    const query = service.createQuery({
      backendId: 'fixture-reactive',
      runtime,
      query: ({ store: captured }) => {
        expect(captured).toBe(store)
        return 'computed'
      }
    })
    await query.ready
    const state = query.state
    expect(state.runtime).toBe(runtime)
    expect(state.value).toMatchObject({ status: 'ready', value: 'computed' })
    expect(state.peek()).toBe(state.value)
    expect(state.observed).toBeTypeOf('boolean')
    expect(state).not.toHaveProperty('dispose')
    expect(query.consistency).toEqual({ mode: 'push', visibility: 'instance' })
    expect('pollIntervalMs' in query.consistency).toBe(false)
    expect(Reflect.set(state, 'value', 'forged')).toBe(false)
    expect(query.state.value.value).toBe('computed')
    await query.dispose()
    expect(query.state.value).toMatchObject({ status: 'disposed', value: 'computed' })
    await host.dispose()
  })

  it('projects the exact Resource failure into the computed error state', async () => {
    const { host, service } = await createReactiveServiceFixture({ id: 'error-1' })
    const runtime = createRuntime()
    const cause = new Error('r12 query failure')
    const query = service.createQuery({
      backendId: 'error-1',
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
    const { host, service } = await createReactiveServiceFixture({ id: 'fixture-refresh' })
    const runtime = createRuntime()
    let reads = 0
    let resolveRefresh!: (value: string) => void
    const pendingRefresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    const query = service.createQuery({
      backendId: 'fixture-refresh',
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
