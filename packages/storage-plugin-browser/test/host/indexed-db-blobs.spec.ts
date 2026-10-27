import { memoryTestFeatures } from '../helpers/memory-features.js'
import { indexedDbTestFeatures } from '../helpers/indexed-db-features.js'
// @vitest-environment node
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { createStorageHost, createOrgId, defineFeature } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { indexedDbBackendPlugin, indexedDbBackendKind } from '../../src/indexed-db.js'
import { indexedDbBlobFeature } from '../../src/features/blobs.js'

describe('native IndexedDB Blob Feature', () => {
  it('uses exact physical org clients and shares the original native record transaction', async () => {
    const factory = new IDBFactory()
    const first = createOrgId()
    const second = createOrgId()
    const nativeClients: IDBTransaction[] = []
    const native = defineFeature(indexedDbBackendKind, () => ({
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          native: {
            async name() {
              return this.client.name
            }
          }
        },
        transaction: {
          native: {
            async name() {
              nativeClients.push(this.client)
              return this.client.db.name
            }
          }
        }
      }
    }))
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(
          { factory, keyRange: IDBKeyRange, dbName: 'native-blobs' },
          { ...indexedDbTestFeatures, blobs: indexedDbBlobFeature(), native }
        )
      ]
    })
    const root = host.backend('indexed-db')
    const left = host.org(first).backend('indexed-db')
    const right = host.org(second).backend('indexed-db')
    expect(await root.api.native.name()).toBe('native-blobs')
    expect(await left.api.native.name()).toBe('native-blobs/' + first)
    expect(await right.api.native.name()).toBe('native-blobs/' + second)
    const blob = new Blob(['original'], { type: 'text/plain' })
    /** Observe the original engine only after installation and before the public Blob write. */
    const nativePut = vi.spyOn(IDBObjectStore.prototype, 'put')
    /** Blob reads must reach their own physical object store, separately from record reads. */
    const nativeGet = vi.spyOn(IDBObjectStore.prototype, 'get')
    onTestFinished(() => {
      nativePut.mockRestore()
      nativeGet.mockRestore()
    })
    await root.api.blobs.put('avatar', blob)
    expect(nativePut.mock.contexts.map((store) => (store as IDBObjectStore).name)).toContain(
      '__migaia_blobs__'
    )
    nativeGet.mockClear()
    expect(await (await root.api.blobs.get('avatar'))!.text()).toBe('original')
    expect(nativeGet.mock.contexts.map((store) => (store as IDBObjectStore).name)).toContain(
      '__migaia_blobs__'
    )
    await left.transaction(async (scope) => {
      await scope.api.blobs.put('avatar', new Blob(['left']))
      expect(await scope.api.native.name()).toBe('native-blobs/' + first)
      await scope.putRecord({ owner: 'left' }, 'row')
      expect(await scope.api.native.name()).toBe('native-blobs/' + first)
      expect(await (await scope.api.blobs.get('avatar'))!.text()).toBe('left')
    })
    expect(nativeClients).toHaveLength(2)
    expect(nativeClients[0]).toBe(nativeClients[1])
    expect(nativeClients[0]!.objectStoreNames.contains('__migaia_blobs__')).toBe(true)
    expect(nativeClients[0]!.objectStoreNames.contains('records')).toBe(true)
    expect(await (await root.api.blobs.get('avatar'))!.text()).toBe('original')
    expect(await right.api.blobs.get('avatar')).toBeUndefined()
    expect(await left.getRecord('row')).toEqual({ owner: 'left' })
    await host.dropOrg(first)
    expect(await left.api.blobs.get('avatar')).toBeUndefined()
    await left.api.blobs.put('avatar', new Blob(['reused']))
    expect(await (await left.api.blobs.get('avatar'))!.text()).toBe('reused')
    expect(await (await root.api.blobs.get('avatar'))!.type).toBe('text/plain')
    await left.api.blobs.remove('avatar')
    await left.api.blobs.remove('avatar')
    expect(await left.api.blobs.get('avatar')).toBeUndefined()
  })

  it('rolls back Blob and records together and rejects saved native APIs after their scope ends', async () => {
    const factory = new IDBFactory()
    const failure = new Error('business callback failed')
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(
          { factory, keyRange: IDBKeyRange },
          { ...indexedDbTestFeatures, blobs: indexedDbBlobFeature({ storeName: 'attachments' }) }
        )
      ]
    })
    const store = host.backend('indexed-db')
    let late!: () => Promise<Blob | undefined>
    const rejected = await store
      .transaction(async (scope) => {
        late = () => scope.api.blobs.get('key')
        await scope.api.blobs.put('key', new Blob(['discard']))
        await scope.putRecord({ discarded: true }, 'row')
        throw failure
      })
      .catch((error: unknown) => error)
    expect(walkErrorCauses(rejected)).toContain(failure)
    expect(await store.api.blobs.get('key')).toBeUndefined()
    expect(await store.getRecord('row')).toBeUndefined()
    const nativeReads = vi.spyOn(IDBObjectStore.prototype, 'get')
    try {
      const lateFailure = await late().catch((error: unknown) => error)
      expect(lateFailure).toMatchObject({ code: 'TRANSACTION_FAILED' })
      expect(nativeReads).not.toHaveBeenCalled()
    } finally {
      nativeReads.mockRestore()
    }
    const abort = new AbortController()
    abort.abort(failure)
    await expect(
      store.api.blobs.put('key', new Blob(['discard']), { signal: abort.signal })
    ).rejects.toMatchObject({ code: 'ABORTED' })
    expect(await store.api.blobs.get('key')).toBeUndefined()
    // @ts-expect-error The native Feature accepts only Blob/File values.
    await expect(store.api.blobs.put('key', { wrong: true })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(await store.api.blobs.get('key')).toBeUndefined()
  })

  it('rejects duplicate declarations and kind mismatch before opening a database', async () => {
    const factory = new IDBFactory()
    const open = vi.spyOn(factory, 'open')
    await expect(
      createStorageHost({
        plugins: [
          indexedDbBackendPlugin(
            { factory, keyRange: IDBKeyRange },
            {
              ...indexedDbTestFeatures,
              first: indexedDbBlobFeature(),
              second: indexedDbBlobFeature()
            }
          )
        ]
      })
    ).rejects.toBeDefined()
    expect(open).not.toHaveBeenCalled()
    await expect(
      createStorageHost({
        // @ts-expect-error Blob Feature targets only the authentic IndexedDB kind token.
        plugins: [memoryBackendPlugin({}, { ...memoryTestFeatures, blobs: indexedDbBlobFeature() })]
      })
    ).rejects.toBeDefined()
    expect(open).not.toHaveBeenCalled()
    expect(() => indexedDbBlobFeature({ storeName: '' })).toThrow()
  })
})
