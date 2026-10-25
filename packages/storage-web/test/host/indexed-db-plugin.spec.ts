import { indexedDbTestFeatures } from '../helpers/indexed-db-features.js'
import { IDBDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '../../src/plugins/indexed-db.js'

describe('IndexedDB backend plugin', () => {
  it('prepares the canonical layout before publishing the exact store', async () => {
    const host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(
          {
            id: 'idb',
            factory: new IDBFactory(),
            keyRange: IDBKeyRange,
            dbName: 'r07-host-idb'
          },
          indexedDbTestFeatures
        )
      ] as const
    })
    const store = host.backend('idb')
    expect(store.capabilities.secondaryIndexes).toBe(true)
    await expect(store.get('prepared')).resolves.toBeNull()
    await host.dispose()
  })

  it('does not publish an incompatible physical layout', async () => {
    const factory = new IDBFactory()
    const request = factory.open('r07-host-conflict', 1)
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' })
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    await expect(
      createStorageHost({
        plugins: [
          indexedDbBackendPlugin(
            {
              id: 'idb-conflict',
              factory,
              keyRange: IDBKeyRange,
              dbName: 'r07-host-conflict'
            },
            indexedDbTestFeatures
          )
        ] as const
      })
    ).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
  })

  it('registers cleanup before native prepare and closes each acquired connection once', async () => {
    const factory = new IDBFactory()
    const request = factory.open('register-before-native-prepare', 1)
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' })
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    /** Observe the actual native resource acquired by the public plugin's failed preparation. */
    const close = vi.spyOn(IDBDatabase.prototype, 'close')
    try {
      await expect(
        createStorageHost({
          plugins: [
            indexedDbBackendPlugin(
              {
                factory,
                keyRange: IDBKeyRange,
                dbName: 'register-before-native-prepare'
              },
              indexedDbTestFeatures
            )
          ]
        })
      ).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
      expect(close.mock.calls.length).toBeGreaterThan(0)
      expect(new Set(close.mock.contexts).size).toBe(close.mock.calls.length)
    } finally {
      close.mockRestore()
    }
  })
})
