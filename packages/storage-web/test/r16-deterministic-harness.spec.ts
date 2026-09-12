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

/** Deterministic R16 business probes over the canonical lifecycle, Resource, and Host owners. */
describe('SWV4 R16 deterministic shared harness', () => {
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
    const first = definePlugin('r16-native-duplicate', firstDescriptor)
    const second = definePlugin('r16-native-duplicate', secondDescriptor)
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
    const mixedDuplicateNative = definePlugin('r16-mixed-duplicate', (core) => ({
      install: () => {
        core.registerStore(memoryStorageHost())
        return mixedInstall()
      }
    }))
    const mixedCreate = vi.fn(() => memoryStorageHost())
    const mixedNative = definePlugin('r16-mixed-duplicate', (core) => ({
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
        definePlugin('r16-installed-duplicate', (core) => ({
          install: () => {
            core.registerStore(memoryStorageHost())
            return {}
          }
        }))
      ] as const
    })
    const installedCreate = vi.fn(() => memoryStorageHost())
    const installedNative = definePlugin('r16-installed-duplicate', (core) => ({
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
  it('SWV4-T15/T16/T17 commits once, contains listener failure, and preserves disposal identity', async () => {
    const store = memoryStorageHost()
    const controller = getBackendReactiveController(store)
    if (controller === undefined) throw new Error('missing memory controller')
    const events: unknown[] = []
    const unsubscribeFailure = controller.subscribe(() => {
      throw new Error('r16 listener failure')
    })
    const unsubscribeObserver = controller.subscribe((event) => events.push(event))

    const cleanup = await captureOperationCleanup(() => store.set('r16-commit', 'value'))
    expect(cleanup.result).toBeUndefined()
    expect(cleanup.reports).toEqual([
      expect.objectContaining({
        source: '@migaia/event-subscriber',
        code: 'PUBLISH_FAILED',
        cause: expect.objectContaining({ message: 'r16 listener failure' })
      })
    ])
    expect(events).toHaveLength(1)
    await expect(store.set('r16-invalid', 42 as never)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    await expect(store.get('r16-commit')).resolves.toBe('value')

    const firstDispose = store.dispose()
    expect(store.dispose()).toBe(firstDispose)
    await firstDispose
    unsubscribeFailure()
    unsubscribeObserver()
  })

  it('SWV4-T20/T21/T22/T23 uses Resource state and lifecycle cleanup for invalidation and terminal refresh', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r16-resource' })] as const
    })
    const runtime = createRuntime()
    let reads = 0
    const query = host.liveQuery({
      backendId: 'r16-resource',
      runtime,
      query: ({ store }) => {
        reads += 1
        return store.get('r16-value')
      }
    })

    await query.ready
    expect(query.state.value).toMatchObject({ status: 'ready', value: null })
    await host.backend('r16-resource').set('r16-value', 'updated')
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

  it('SWV4-T51 re-queries through each of the five canonical adapters after a library commit', async () => {
    const host = await createStorageHost({
      plugins: [
        memoryReactive({ id: 'r16-five-memory' }),
        localStorageReactive({
          id: 'r16-five-local',
          namespace: 'r16-five-local',
          storage: fakeWebStorage()
        }),
        sessionStorageReactive({
          id: 'r16-five-session',
          namespace: 'r16-five-session',
          storage: fakeWebStorage()
        }),
        cookiesReactive({
          id: 'r16-five-cookiesHost',
          namespace: 'r16-five-cookiesHost',
          document: fakeCookieDocument()
        }),
        indexedDbReactive({
          id: 'r16-five-indexed',
          dbName: `r16-five-${Math.random().toString(36).slice(2)}`,
          factory: new IDBFactory(),
          keyRange: IDBKeyRange
        })
      ] as const
    })
    const runtime = createRuntime()
    const backendIds = [
      'r16-five-memory',
      'r16-five-local',
      'r16-five-session',
      'r16-five-cookiesHost',
      'r16-five-indexed'
    ] as const
    try {
      for (const backendId of backendIds) {
        let reads = 0
        const query = host.liveQuery({
          backendId,
          runtime,
          query: ({ store }) => {
            reads += 1
            return store.get('r16-five-value')
          }
        })
        await query.ready
        await host.backend(backendId).set('r16-five-value', backendId)
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

  it('SWV4-T24/T25/T26/T27/T28/T29/T30 preserves exact multi-backend Host publication and teardown ownership', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r16-first' }), memoryReactive({ id: 'r16-second' })] as const
    })
    const first = host.backend('r16-first')
    const second = host.backend('r16-second')
    expect(host.hasReactiveBackend('r16-first')).toBe(true)
    expect(host.hasReactiveBackend('r16-second')).toBe(true)
    expect(host.reactiveBackend('r16-first')?.store).toBe(first)
    expect(host.reactiveBackend('r16-second')?.store).toBe(second)
    const dynamicHost = host as unknown as {
      readonly use: (plugin: unknown) => Promise<unknown>
    }
    const duplicateFailure = await dynamicHost
      .use(memoryReactive({ id: 'r16-first' }))
      .catch((error: unknown) => error)
    expect(duplicateFailure).toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
    expect((duplicateFailure as Error).cause).toMatchObject({
      code: 'REACTIVE_TOPOLOGY_INVALID'
    })
    expect([...host.backends().keys()]).toEqual(['r16-first', 'r16-second'])
    const firstDispose = host.dispose()
    expect(host.dispose()).toBe(firstDispose)
    await firstDispose
  })
})
