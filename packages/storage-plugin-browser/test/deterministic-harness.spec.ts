import { memoryTestFeatures } from './helpers/memory-features.ts'
import { entityTestFeatures } from './helpers/entity-features.ts'
import { indexedDbTestFeatures } from './helpers/indexed-db-features.ts'
import { createRuntime } from '@migaia/reactive'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { fakeCookieDocument } from '../src/testing/fake-cookie-document.ts'
import { fakeWebStorage } from '../src/testing/fake-web-storage.ts'
import { cookieBackendPlugin, cookieBackendKind } from '../src/cookies.ts'
import { indexedDbBackendPlugin, indexedDbBackendKind } from '../src/indexed-db.ts'
import { localStorageBackendPlugin, localStorageBackendKind } from '../src/local-storage.ts'
import { sessionStorageBackendPlugin, sessionStorageBackendKind } from '../src/session-storage.ts'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin, memoryBackendKind } from '@migaia/storage-host/plugins/memory'
import { defineEntity } from '@migaia/storage-host/entity'
import { reactiveFeature } from '../src/features/reactive.ts'
import { createReactiveServiceFixture } from './helpers/reactive-service.ts'

/** Deterministic business probes over the canonical lifecycle, Resource, and Host owners. */
describe('deterministic shared harness', () => {
  it('uses Resource state and lifecycle cleanup for invalidation and terminal refresh', async () => {
    const { host, store, service } = await createReactiveServiceFixture({ id: 'fixture-resource' })
    const runtime = createRuntime()
    let reads = 0
    const query = service.createQuery({
      backendId: 'fixture-resource',
      runtime,
      query: () => {
        reads += 1
        return store.get('value-2')
      }
    })

    await query.ready
    expect(query.state.value).toMatchObject({ status: 'ready', value: null })
    await store.set('value-2', 'updated')
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
        memoryBackendPlugin(
          { id: 'five-memory' },
          { ...memoryTestFeatures, reactive: reactiveFeature(memoryBackendKind) }
        ),
        localStorageBackendPlugin(
          {
            id: 'five-local',
            namespace: 'five-local',
            storage: fakeWebStorage()
          },
          { reactive: reactiveFeature(localStorageBackendKind) }
        ),
        sessionStorageBackendPlugin(
          {
            id: 'five-session',
            namespace: 'five-session',
            storage: fakeWebStorage()
          },
          { reactive: reactiveFeature(sessionStorageBackendKind) }
        ),
        cookieBackendPlugin(
          {
            id: 'five-cookiesHost',
            namespace: 'five-cookiesHost',
            document: fakeCookieDocument()
          },
          { reactive: reactiveFeature(cookieBackendKind) }
        ),
        indexedDbBackendPlugin(
          {
            id: 'five-indexed',
            dbName: `five-${Math.random().toString(36).slice(2)}`,
            factory: new IDBFactory(),
            keyRange: IDBKeyRange
          },
          { ...indexedDbTestFeatures, reactive: reactiveFeature(indexedDbBackendKind) }
        )
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
        const store = host.backend(backendId)
        const repository = defineEntity<{ id: string; value: string }>({
          features: entityTestFeatures,
          name: 'live-fixture',
          key: 'id'
        }).connect(store)
        const chain = repository.query()
        const query = chain.live({ runtime })
        await query.ready
        expect(query.state.value).toMatchObject({ status: 'ready', value: [] })
        expect(query.consistency).toEqual(
          backendId === 'five-memory'
            ? { mode: 'push', visibility: 'instance' }
            : {
                mode: 'hybrid',
                visibility:
                  backendId === 'five-local'
                    ? 'document-eventual'
                    : backendId === 'five-session'
                      ? 'top-level-context-eventual'
                      : backendId === 'five-cookiesHost'
                        ? 'origin-js-visible-eventual'
                        : 'origin-eventual',
                pollIntervalMs: 1000
              }
        )
        await repository.put({ id: 'row', value: backendId })
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        /** Join only an actual invalidation's pending generation, without creating a refresh. */
        if (query.state.value.status === 'refreshing') await query.refresh()
        expect(query.state.value).toMatchObject({
          status: 'ready',
          value: [{ id: 'row', value: backendId }]
        })
        await query.dispose()
      }
    } finally {
      await host.dispose()
    }
  })
})
