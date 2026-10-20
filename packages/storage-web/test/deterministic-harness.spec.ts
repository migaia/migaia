import { createRuntime } from '@migaia/reactive'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { fakeCookieDocument } from '../src/testing/fake-cookie-document.js'
import { fakeWebStorage } from '../src/testing/fake-web-storage.js'
import { memoryStorageHost } from '../src/backends/memory.js'
import { getBackendReactiveController } from '../src/backends/reactive-controller.js'
import type { IStoragePluginCore } from '../src/host/contracts.js'
import { createStorageHost, definePlugin } from '../src/host/index.js'
import { cookiesReactive } from '../src/plugins/reactive/cookies.js'
import { indexedDbReactive } from '../src/plugins/reactive/indexed-db.js'
import { localStorageReactive } from '../src/plugins/reactive/local-storage.js'
import { memoryReactive } from '../src/plugins/reactive/memory.js'
import { sessionStorageReactive } from '../src/plugins/reactive/session-storage.js'
import { captureOperationCleanup } from './helpers/operation-reporter.js'

/** Deterministic business probes over the canonical lifecycle, Resource, and Host owners. */
describe('deterministic shared harness', () => {
  it('rejects duplicate IDs before native install or legacy create runs', async () => {
    const firstInstall = vi.fn(() => ({}))
    const secondInstall = vi.fn(() => ({}))
    const firstDescriptor = vi.fn((core: IStoragePluginCore) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return firstInstall()
      }
    }))
    const secondDescriptor = vi.fn((core: IStoragePluginCore) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return secondInstall()
      }
    }))
    const first = definePlugin('native-duplicate', firstDescriptor)
    const second = definePlugin('native-duplicate', secondDescriptor)
    await expect(createStorageHost({ plugins: [first, second] as never })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      cause: { code: 'REACTIVE_TOPOLOGY_INVALID' }
    })
    // Host admission precedes native descriptor construction as well as installation.
    expect(firstDescriptor).not.toHaveBeenCalled()
    expect(secondDescriptor).not.toHaveBeenCalled()
    expect(firstInstall).not.toHaveBeenCalled()
    expect(secondInstall).not.toHaveBeenCalled()

    const mixedInstall = vi.fn(() => ({}))
    const mixedDuplicateNative = definePlugin('mixed-duplicate', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return mixedInstall()
      }
    }))
    const mixedCreate = vi.fn(() => memoryStorageHost())
    const mixedNative = definePlugin('mixed-duplicate', (core) => ({
      install: () => {
        core.registerStore(mixedCreate())
        return {}
      }
    }))
    await expect(
      createStorageHost({ plugins: [mixedNative, mixedDuplicateNative] as never })
    ).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      cause: { code: 'REACTIVE_TOPOLOGY_INVALID' }
    })
    expect(mixedInstall).not.toHaveBeenCalled()
    expect(mixedCreate).not.toHaveBeenCalled()

    const installed = await createStorageHost({
      plugins: [
        definePlugin('installed-duplicate', (core) => ({
          install: () => {
            core.registerStore(memoryStorageHost())
            return {}
          }
        }))
      ] as const
    })
    const installedCreate = vi.fn(() => memoryStorageHost())
    const installedNative = definePlugin('installed-duplicate', (core) => ({
      install: () => {
        core.registerStore(installedCreate())
        return {}
      }
    }))
    try {
      await expect(
        (installed as unknown as { readonly use: (plugin: unknown) => Promise<unknown> }).use(
          installedNative
        )
      ).rejects.toMatchObject({
        code: 'BACKEND_INSTALL_FAILED',
        cause: { code: 'REACTIVE_TOPOLOGY_INVALID' }
      })
      expect(installedCreate).not.toHaveBeenCalled()
    } finally {
      await installed.dispose()
    }
  })
  it('commits once, contains listener failure, and preserves disposal identity', async () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)
    if (controller === undefined) throw new Error('missing memory controller')
    const events: unknown[] = []
    const unsubscribeFailure = controller.subscribe(() => {
      throw new Error('r16 listener failure')
    })
    const unsubscribeObserver = controller.subscribe((event) => events.push(event))

    const cleanup = await captureOperationCleanup(() => store.set('fixture-commit', 'value'))
    expect(cleanup.result).toBeUndefined()
    expect(cleanup.reports).toEqual([
      expect.objectContaining({
        source: '@migaia/event-subscriber',
        code: 'PUBLISH_FAILED',
        cause: expect.objectContaining({ message: 'r16 listener failure' })
      })
    ])
    expect(events).toHaveLength(1)
    await expect(store.set('fixture-invalid', 42 as never)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    await expect(store.get('fixture-commit')).resolves.toBe('value')

    const firstDispose = store.dispose()
    expect(store.dispose()).toBe(firstDispose)
    await firstDispose
    unsubscribeFailure()
    unsubscribeObserver()
  })

  it('uses Resource state and lifecycle cleanup for invalidation and terminal refresh', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'fixture-resource' })] as const
    })
    const runtime = createRuntime()
    let reads = 0
    const query = host.liveQuery({
      backendId: 'fixture-resource',
      runtime,
      query: ({ store }) => {
        reads += 1
        return store.get('value-2')
      }
    })

    await query.ready
    expect(query.state.value).toMatchObject({ status: 'ready', value: null })
    await host.backend('fixture-resource').set('value-2', 'updated')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(query.state.value).toMatchObject({ status: 'ready', value: 'updated' })
    expect(reads).toBe(2)

    const firstDispose = query.dispose()
    expect(query.dispose()).toBe(firstDispose)
    await firstDispose
    await expect(query.refresh()).rejects.toMatchObject({ code: 'LIVE_QUERY_DISPOSED' })
    await host.dispose()
  })

  it('re-queries through each of the five canonical adapters after a library commit', async () => {
    const host = await createStorageHost({
      plugins: [
        memoryReactive({ id: 'five-memory' }),
        localStorageReactive({
          id: 'five-local',
          namespace: 'five-local',
          storage: fakeWebStorage()
        }),
        sessionStorageReactive({
          id: 'five-session',
          namespace: 'five-session',
          storage: fakeWebStorage()
        }),
        cookiesReactive({
          id: 'five-cookiesHost',
          namespace: 'five-cookiesHost',
          document: fakeCookieDocument()
        }),
        indexedDbReactive({
          id: 'five-indexed',
          dbName: `five-${Math.random().toString(36).slice(2)}`,
          factory: new IDBFactory(),
          keyRange: IDBKeyRange
        })
      ] as const
    })
    const runtime = createRuntime()
    const backendIds = [
      'five-memory',
      'five-local',
      'five-session',
      'five-cookiesHost',
      'five-indexed'
    ] as const
    try {
      for (const backendId of backendIds) {
        let reads = 0
        const query = host.liveQuery({
          backendId,
          runtime,
          query: ({ store }) => {
            reads += 1
            return store.get('five-value')
          }
        })
        await query.ready
        await host.backend(backendId).set('five-value', backendId)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(query.state.value).toMatchObject({ status: 'ready', value: backendId })
        expect(reads).toBeGreaterThan(1)
        await query.dispose()
      }
    } finally {
      await host.dispose()
    }
  })

  it('preserves exact multi-backend Host publication and teardown ownership', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'first-2' }), memoryReactive({ id: 'second-2' })] as const
    })
    const first = host.backend('first-2')
    const second = host.backend('second-2')
    expect(host.hasReactiveBackend('first-2')).toBe(true)
    expect(host.hasReactiveBackend('second-2')).toBe(true)
    expect(host.reactiveBackend('first-2')?.store).toBe(first)
    expect(host.reactiveBackend('second-2')?.store).toBe(second)
    const dynamicHost = host as unknown as {
      readonly use: (plugin: unknown) => Promise<unknown>
    }
    const duplicateFailure = await dynamicHost
      .use(memoryReactive({ id: 'first-2' }))
      .catch((error: unknown) => error)
    expect(duplicateFailure).toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    expect((duplicateFailure as Error).cause).toMatchObject({
      code: 'REACTIVE_TOPOLOGY_INVALID'
    })
    expect([...host.backends().keys()]).toEqual(['first-2', 'second-2'])
    const firstDispose = host.dispose()
    expect(host.dispose()).toBe(firstDispose)
    await firstDispose
  })
})
