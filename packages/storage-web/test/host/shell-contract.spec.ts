import { describe, expect, it } from 'vitest'
import {
  STORAGE_LIVE_QUERY_SERVICE_NAME,
  createStorageHost,
  defineFeature,
  definePlugin,
  pluginNameFromBackendId,
  reactiveAdapterNameFromBackendId
} from '../../src/host/index.js'
import { memoryStorageHost } from '../../src/backends/memory.js'
import { defineReactiveAdapterFeature } from '../../src/reactive-adapter.js'
import { createManualScheduler, type ILifecycleScheduler } from '@migaia/lifecycle'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { IKeyValueStore } from '@migaia/storage-contract'

/** Minimal valid store used only to exercise opaque type identity and R02 admission. */
const store = memoryStorageHost() as IKeyValueStore

describe('SWV4-B02 R02 shell', () => {
  it('keeps names canonical and inspects native Feature closure without executing factories', () => {
    expect(pluginNameFromBackendId('a.b')).toBe('storage-backend:612E62')
    expect(reactiveAdapterNameFromBackendId('a-b')).toBe('storage-reactive-adapter:612D62')
    expect(STORAGE_LIVE_QUERY_SERVICE_NAME).toBe('storage-live-query-service')

    const source = defineFeature(() => ({ value: 'source' as const }))
    const derived = defineFeature((_core, dependencies) => ({ value: dependencies.source.value }), {
      source
    })
    expect(inspectFeatures({ derived }).ordered).toEqual([source, derived])
  })

  it('rejects concurrent facade batches and allows explicit retry after settlement', async () => {
    const host = await createStorageHost()
    const plugin = definePlugin('one', (core) => ({
      install: () => {
        core.registerStore(store)
        return {}
      }
    }))
    const retryPlugin = definePlugin('two', (core) => ({
      install: () => {
        core.registerStore(store)
        return {}
      }
    }))
    const first = host.use(plugin)
    expect(() => host.use(plugin)).toThrowError('storage host is busy installing plugins')
    await first
    await host.use(retryPlugin)
    await host.dispose()
  })

  it('rejects a use batch when disposal wins before preflight', async () => {
    const host = await createStorageHost()
    const plugin = definePlugin('late', (core) => ({
      install: () => {
        core.registerStore(store)
        return {}
      }
    }))
    const installing = host.use(plugin)
    const disposing = host.dispose()
    await expect(installing).rejects.toMatchObject({
      code: 'STORAGE_HOST_DISPOSED'
    })
    await disposing
    expect(host.dispose()).toBe(disposing)
  })

  it('materializes a kind-free adapter through native Plugin features with the Host scheduler', async () => {
    const scheduler = createManualScheduler()
    let receivedScheduler: ILifecycleScheduler | undefined
    const reactive = defineReactiveAdapterFeature({
      mode: 'push',
      visibility: 'instance',
      subscribe: (context) => {
        receivedScheduler = context.scheduler
        return () => undefined
      }
    })
    const plugin = definePlugin(
      'one',
      (core) => ({
        install: () => {
          core.registerStore(store)
          return {}
        }
      }),
      { reactive }
    )
    const host = await createStorageHost({ scheduler })
    await host.use(plugin)
    expect(receivedScheduler).toBeDefined()
    let scheduled = false
    receivedScheduler!.schedule(() => {
      scheduled = true
    }, 5)
    scheduler.advance(5)
    expect(scheduled).toBe(true)
    await host.dispose()
  })
})
