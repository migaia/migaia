import { indexedDbTestFeatures } from '../helpers/indexed-db-features.js'
import type { IKeyValueStore } from '@migaia/storage-contract'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createStorageHost, defineFeature } from '@migaia/storage-host'
import type { IBackendChangeController } from '@migaia/storage-host/authoring/backend'
import { cookieBackendPlugin, cookieBackendKind } from '../../src/cookies.js'
import { localStorageBackendPlugin, localStorageBackendKind } from '../../src/local-storage.js'
import {
  sessionStorageBackendPlugin,
  sessionStorageBackendKind
} from '../../src/session-storage.js'
import { indexedDbBackendPlugin, indexedDbBackendKind } from '../../src/indexed-db.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'

type IObservedBackend = {
  readonly name: string
  readonly store: IKeyValueStore
  readonly controller: IBackendChangeController
  readonly write: () => Promise<void>
}

/** Browser cases capture each exact controller only through the actual installed Feature expose. */
const createObservedBackends = async (): Promise<IObservedBackend[]> => {
  /** Deferred reads retain the original exposure window after native preparation succeeds. */
  const readControllers: (() => {
    readonly id: string
    readonly controller: IBackendChangeController
  })[] = []
  const feature = defineFeature(
    [localStorageBackendKind, sessionStorageBackendKind, cookieBackendKind, indexedDbBackendKind],
    ({ featureExpose }) => {
      readControllers.push(() => ({
        id: featureExpose.getBackendId(),
        controller: featureExpose.getChangeController()!
      }))
      return { capabilities: [] as const, chain: {}, api: { store: {}, transaction: {} } }
    }
  )
  const host = await createStorageHost({
    plugins: [
      localStorageBackendPlugin(
        { namespace: 'controller-local', storage: fakeWebStorage() },
        { controller: feature }
      ),
      sessionStorageBackendPlugin(
        { namespace: 'controller-session', storage: fakeWebStorage() },
        { controller: feature }
      ),
      cookieBackendPlugin(
        { namespace: 'controller-cookie', document: fakeCookieDocument() },
        { controller: feature }
      ),
      indexedDbBackendPlugin(
        {
          dbName: `controller-${Math.random().toString(36).slice(2)}`,
          factory: new IDBFactory(),
          keyRange: IDBKeyRange
        },
        { ...indexedDbTestFeatures, controller: feature }
      )
    ]
  })
  onTestFinished(() => host.dispose())
  const controllers = readControllers.map((read) => read())
  return (['local', 'session', 'cookies', 'indexed-db'] as const).map((id) => {
    const store = host.backend(id)
    const controller = controllers.find((entry) => entry.id === id)!.controller
    return { name: id, store, controller, write: () => store.set('key', 'value') }
  })
}

describe('private backend reactive controller', () => {
  it('registers one exact controller for each canonical factory and publishes after success', async () => {
    const backends = await createObservedBackends()
    try {
      for (const observed of backends) {
        const controller = observed.controller
        expect(controller).toBeDefined()
        expect(controller?.snapshot.backend).toBe(observed.store.backend)
        const events: unknown[] = []
        const unsubscribe = controller!.subscribe((event) => events.push(event))
        await observed.write()
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ channel: 'value', kind: 'put', keys: ['key'] })
        unsubscribe()
      }
    } finally {
      await Promise.all(backends.map((observed) => observed.store.dispose()))
    }
  })

  it('returns one exact disposal Promise for every canonical backend store', async () => {
    const backends = await createObservedBackends()
    const disposals = backends.map((observed) => {
      const first = observed.store.dispose()
      expect(observed.store.dispose()).toBe(first)
      return first
    })
    await Promise.all(disposals)
  })
})
