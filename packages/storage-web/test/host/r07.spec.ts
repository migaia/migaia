import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../../src/backends/memory.js'
import {
  createStorageHost,
  defineStorageBackendKind,
  defineStorageBackendPlugin
} from '../../src/host/index.js'
import type { IKeyValueStore } from '../../src/types/storage.js'
import { indexedDbBackendPlugin } from '../../src/plugins/indexed-db.js'

describe('SWV4-R07 IndexedDB backend plugin', () => {
  it('prepares the canonical layout before publishing the exact store', async () => {
    const host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({
          id: 'idb',
          factory: new IDBFactory(),
          keyRange: IDBKeyRange,
          dbName: 'r07-host-idb'
        })
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
          indexedDbBackendPlugin({
            id: 'idb-conflict',
            factory,
            keyRange: IDBKeyRange,
            dbName: 'r07-host-conflict'
          })
        ] as const
      })
    ).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
  })

  it('registers disposer before prepare and rolls back exactly once on prepare failure', async () => {
    const source = memoryStorage()
    const events: string[] = []
    const store = {
      ...source,
      dispose: async () => {
        events.push('dispose')
        await source.dispose()
      }
    } satisfies IKeyValueStore
    const kind = defineStorageBackendKind<IKeyValueStore>()('r07-register-prepare')
    const plugin = defineStorageBackendPlugin({
      backendKind: kind,
      id: 'r07-register-prepare',
      create: () => {
        events.push('create')
        return store
      },
      prepare: async () => {
        events.push('prepare')
        throw new Error('prepare failed')
      }
    })

    await expect(createStorageHost({ plugins: [plugin] as const })).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED'
    })
    expect(events).toEqual(['create', 'prepare', 'dispose'])
  })
})
