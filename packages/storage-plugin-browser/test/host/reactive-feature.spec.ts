import { memoryTestFeatures } from '../helpers/memory-features.ts'
import { createRuntime } from '@migaia/reactive'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { records } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import {
  STORAGE_HOST_ERROR_SOURCE,
  StorageHostErrorCode
} from '@migaia/storage-contract/error-code'
import { memoryBackendKind, memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { reactiveFeature } from '../../src/features/reactive.ts'
import * as reactiveModule from '../../src/host/reactive.ts'

/** Public Feature cases use actual installed record queries and the original Resource lifecycle. */
describe('reactive Feature', () => {
  it('creates per-registration services but starts each original source only on first live', async () => {
    /** Capture the original services without replacing their objects or state owners. */
    const services: reactiveModule.IStorageReactiveService[] = []
    const create = reactiveModule.createStorageReactiveService
    const factory = vi
      .spyOn(reactiveModule, 'createStorageReactiveService')
      .mockImplementation(() => {
        const service = create()
        services.push(service)
        return service
      })
    try {
      const feature = reactiveFeature(memoryBackendKind)
      const host = await createStorageHost({
        plugins: [
          memoryBackendPlugin({ id: 'first' }, { ...memoryTestFeatures, reactive: feature }),
          memoryBackendPlugin({ id: 'second' }, { ...memoryTestFeatures, reactive: feature })
        ]
      })
      expect(services).toHaveLength(2)
      expect(services[0]).not.toBe(services[1])
      const firstRegister = vi.spyOn(services[0]!, 'registerAdapter')
      const secondRegister = vi.spyOn(services[1]!, 'registerAdapter')
      const runtime = createRuntime()
      expect(firstRegister).not.toHaveBeenCalled()
      const first = host.backend('first').use(records).query().live({ runtime })
      const again = host.backend('first').use(records).query().live({ runtime })
      await Promise.all([first.ready, again.ready])
      expect(firstRegister).toHaveBeenCalledTimes(1)
      expect(firstRegister.mock.calls[0]![0].store).toBe(host.backend('first'))
      expect(secondRegister).not.toHaveBeenCalled()
      const second = host.backend('second').use(records).query().live({ runtime })
      await second.ready
      expect(secondRegister).toHaveBeenCalledTimes(1)
      expect(secondRegister.mock.calls[0]![0].store).toBe(host.backend('second'))
      expect(first.consistency).toEqual({ mode: 'push', visibility: 'instance' })
      await host.dispose()
      expect(first.state.value.status).toBe('disposed')
      expect(second.state.value.status).toBe('disposed')
      expect(runtime.computed(() => 'borrowed').value).toBe('borrowed')
    } finally {
      factory.mockRestore()
    }
  })

  it('rejects memory live without notifications before adapter or query admission', async () => {
    /** Capture the actual service so absence is proven before its original adapter allocation. */
    const services: reactiveModule.IStorageReactiveService[] = []
    const create = reactiveModule.createStorageReactiveService
    const factory = vi
      .spyOn(reactiveModule, 'createStorageReactiveService')
      .mockImplementation(() => {
        const service = create()
        services.push(service)
        return service
      })
    try {
      const host = await createStorageHost({
        plugins: [memoryBackendPlugin(undefined, { reactive: reactiveFeature(memoryBackendKind) })]
      })
      try {
        const register = vi.spyOn(services[0]!, 'registerAdapter')
        const createQuery = vi.spyOn(services[0]!, 'createQuery')
        const store = host.backend('memory')
        await store.putRecord({ value: 'base remains usable' }, 'record')
        await expect(store.getRecord('record')).resolves.toEqual({ value: 'base remains usable' })
        expect(() => store.use(records).query().live({ runtime: createRuntime() })).toThrow(
          expect.objectContaining({
            source: STORAGE_HOST_ERROR_SOURCE,
            code: StorageHostErrorCode.changeControllerNotAssembled
          })
        )
        expect(register).not.toHaveBeenCalled()
        expect(createQuery).not.toHaveBeenCalled()
      } finally {
        await host.dispose()
      }
    } finally {
      factory.mockRestore()
    }
  })

  it('preserves equal settled identity across invalidation', async () => {
    const host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          ...memoryTestFeatures,
          reactive: reactiveFeature(memoryBackendKind)
        })
      ]
    })
    const store = host.backend('memory')
    await store.putRecord({ value: 'initial' }, 'record')
    const terminal = vi.fn((value: { value: string }) => value)
    const chain = store.use(records).query<{ value: string }>().select(terminal)
    const runtime = createRuntime()
    const query = chain.live({
      runtime,
      scope: 'options-scope',
      matches: () => true,
      keepPreviousData: true,
      equals: () => true
    })
    await query.ready
    const first = query.state.value.value
    await store.putRecord({ value: 'changed' }, 'record')
    await vi.waitFor(() => expect(terminal).toHaveBeenCalledTimes(2))
    expect(query.state.value.value).toBe(first)
    await query.dispose()
    await host.dispose()
  })

  it('rejects invalid live options before any source subscription', async () => {
    const host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          ...memoryTestFeatures,
          reactive: reactiveFeature(memoryBackendKind)
        })
      ]
    })
    expect(() =>
      host
        .backend('memory')
        .use(records)
        .query()
        .live(null as never)
    ).toThrow(expect.objectContaining({ code: 'REACTIVE_FEATURE_INVALID' }))
    await host.dispose()
  })

  it('uses the original scheduler and shares one cleanup through both resource entries', async () => {
    const scheduler = createManualScheduler()
    const host = await createStorageHost({
      scheduler,
      plugins: [
        memoryBackendPlugin(undefined, {
          ...memoryTestFeatures,
          reactive: reactiveFeature(memoryBackendKind)
        })
      ]
    })
    const store = host.backend('memory')
    await store.putRecord({ value: 'initial' }, 'record')
    let finish!: (value: string) => void
    const pending = new Promise<string>((resolve) => {
      finish = resolve
    })
    const chain = store
      .use(records)
      .query()
      .select(() => pending)
    const query = chain.live({ runtime: createRuntime(), timeoutMs: 10 })
    scheduler.advance(10)
    await expect(query.ready).rejects.toBeDefined()
    finish('late settlement')
    const explicit = query.dispose()
    const symbolic = query[asyncDisposeKey]()
    expect(query.dispose()).toBe(explicit)
    expect(query[asyncDisposeKey]()).toBe(symbolic)
    expect(symbolic).not.toBe(explicit)
    await Promise.all([explicit, symbolic])
    await host.dispose()
  })
})
