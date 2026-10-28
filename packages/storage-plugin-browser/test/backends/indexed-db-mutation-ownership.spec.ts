import { indexedDbTestFeatures } from '../helpers/indexed-db-features.ts'
import { walkErrorCauses } from '@migaia/utils/error'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createStorageHost, defineFeature } from '@migaia/storage-host'
import { deferred } from '@migaia/utils/promise'
import {
  indexedDbBackendKind,
  indexedDbBackendPlugin,
  type IIndexedDbOptions
} from '../../src/indexed-db.ts'

/** Failed installation retains the native validation failure below the actual host wrapper. */
const expectInvalidInstallation = async (pending: Promise<unknown>): Promise<void> => {
  const failure: unknown = await pending.catch((cause: unknown) => cause)
  expect(failure).toMatchObject({ source: 'storage.host', code: 'BACKEND_INSTALL_FAILED' })
  expect(walkErrorCauses(failure)).toContainEqual(
    expect.objectContaining({
      source: 'storage.backend.browser',
      code: 'INVALID_CONFIG'
    })
  )
}

/** This selected Feature borrows the same controller registered for the native backend. */
const controllerFeature = defineFeature(indexedDbBackendKind, ({ featureExpose }) => ({
  capabilities: [],
  chain: {},
  api: {
    store: { controller: async () => featureExpose.getChangeController() },
    transaction: {}
  }
}))

/** Lifecycle cases install the public plugin and retain its original host for cleanup. */
const createInstalledStore = async (options: IIndexedDbOptions) => {
  /** The fixture borrows the installed backend while its original host owns cleanup. */
  const host = await createStorageHost({
    plugins: [
      indexedDbBackendPlugin(options, { ...indexedDbTestFeatures, ownership: controllerFeature })
    ]
  })
  onTestFinished(() => host.dispose())
  return host.backend('indexed-db')
}

/** Opens a database with one deliberately forgeable public metadata record. */
const createStore = (dbName: string, factory = new IDBFactory()) =>
  createInstalledStore({ factory, keyRange: IDBKeyRange, dbName })

/** Counts lifecycle admissions and releases without changing the controller's behavior. */
const trackMutationLeases = async (store: Awaited<ReturnType<typeof createStore>>) => {
  const controller = (await store.api.controller())!
  let admissions = 0
  let releases = 0
  const beginMutation = controller.beginMutation
  controller.beginMutation = () => {
    admissions += 1
    const release = beginMutation()
    return () => {
      releases += 1
      release()
    }
  }
  return {
    counts: () => ({ admissions, releases })
  }
}

/** Prepares the fixed stores with a deliberately malformed owned sidecar signature. */
const createMalformedSidecarStore = async (
  dbName: string,
  configure: (sidecar: IDBObjectStore) => void
) => {
  const factory = new IDBFactory()
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(dbName, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore('kv')
      database.createObjectStore('bytes')
      database.createObjectStore('records')
      database.createObjectStore('__storage_web_revisions__')
      database.createObjectStore('__storage_web_meta__')
      const sidecar = database.createObjectStore('storage-plugin-browser:index-records', {
        keyPath: ['scope', 'indexName', 'generation', 'indexValue', 'recordKey']
      })
      configure(sidecar)
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
  return createInstalledStore({ factory, keyRange: IDBKeyRange, dbName })
}

/** Creates two complete production handles, then appends a mixed legacy batch for ordering checks. */
const createMixedLegacyStore = async (dbName: string, keys: readonly IDBValidKey[]) => {
  const factory = new IDBFactory()
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(dbName, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      database.createObjectStore('kv')
      database.createObjectStore('bytes')
      database.createObjectStore('records')
      database.createObjectStore('__storage_web_revisions__')
      const metadata = database.createObjectStore('storage-plugin-browser:meta')
      const sidecar = database.createObjectStore('storage-plugin-browser:index-records', {
        keyPath: ['scope', 'indexName', 'generation', 'indexValue', 'recordKey']
      })
      sidecar.createIndex('lookup', ['scope', 'indexName', 'generation', 'indexValue'])
      sidecar.createIndex('record', ['scope', 'generation', 'recordKey'])
      for (const [scope, generation] of [
        ['a', 'ga'],
        ['b', 'gb']
      ])
        metadata.put(
          {
            handle: { scope, generation, fingerprint: '[]' },
            currentGeneration: generation,
            readiness: { status: 'complete', scanned: 1, indexed: 1 }
          },
          ['__storage_web_internal__', 'index', scope]
        )
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
  const handles = [
    { scope: 'a', generation: 'ga', fingerprint: '[]' },
    { scope: 'b', generation: 'gb', fingerprint: '[]' }
  ] as const
  const preflightStore = await createInstalledStore({ factory, keyRange: IDBKeyRange, dbName })
  const initialReadiness = await Promise.all(
    handles.map((handle) => preflightStore.getRecordIndexReadiness(handle))
  )
  await preflightStore.dispose()
  /** Add legacy data after whatever fixed native layout the installation actually prepared. */
  const version = (await factory.databases()).find((database) => database.name === dbName)!.version!
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(dbName, version + 1)
    request.onupgradeneeded = () => {
      const legacy = request.result.createObjectStore('documents')
      keys.forEach((key, index) => legacy.put({ __v: 1, data: { id: index } }, key))
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
  return {
    store: await createInstalledStore({ factory, keyRange: IDBKeyRange, dbName }),
    handles,
    initialReadiness
  }
}

describe('IndexedDB preparation and mutation ownership', () => {
  it('ignores public schema and index strings as backend authority', async () => {
    /** Both registrations reopen the same native data rather than independent factory maps. */
    const factory = new IDBFactory()
    const store = await createStore('r05-public-forge', factory)
    await store.get('probe')
    await store.metadata!.set('schema', { version: 999, migration: 'forged' })
    await store.metadata!.set('index:users', {
      handle: { scope: 'users', generation: 'forged', fingerprint: 'forged' },
      readiness: { status: 'complete', scanned: 99, indexed: 99 }
    })

    const reopened = await createStore('r05-public-forge', factory)
    await expect(reopened.get('still-usable')).resolves.toBeNull()
    await expect(
      reopened
        .iterateRecordIndex({
          handle: { scope: 'users', generation: 'forged', fingerprint: 'forged' },
          index: 'value'
        })
        .next()
    ).rejects.toMatchObject({ code: 'INDEX_BACKFILL_STALE' })
    await store.dispose()
    await reopened.dispose()
  })

  it('cancels a write before native admission and rejects late writes', async () => {
    const store = await createStore('r05-dispose-race')
    const tracker = await trackMutationLeases(store)
    const write = store.putRecord({ value: 1 }, 'record-1')
    await store.dispose()
    await expect(write).rejects.toMatchObject({
      code: 'ABORTED',
      cause: expect.objectContaining({ code: 'STORE_DISPOSED' })
    })
    expect(tracker.counts()).toEqual({ admissions: 1, releases: 1 })
    await expect(store.putRecord({ value: 2 }, 'record-2')).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
  })

  it('rejects an incompatible native layout before publishing the store', async () => {
    const factory = new IDBFactory()
    const dbName = 'r05-layout-conflict'
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => {
        const database = request.result
        database.createObjectStore('kv')
        database.createObjectStore('bytes')
        database.createObjectStore('records', { keyPath: 'id' })
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    await expectInvalidInstallation(
      createInstalledStore({ factory, keyRange: IDBKeyRange, dbName })
    )
  })

  it.each([
    [
      'missing lookup',
      (sidecar: IDBObjectStore) =>
        sidecar.createIndex('record', ['scope', 'generation', 'recordKey'])
    ],
    [
      'missing record',
      (sidecar: IDBObjectStore) =>
        sidecar.createIndex('lookup', ['scope', 'indexName', 'generation', 'indexValue'])
    ],
    [
      'unique lookup',
      (sidecar: IDBObjectStore) => {
        sidecar.createIndex('lookup', ['scope', 'indexName', 'generation', 'indexValue'], {
          unique: true
        })
        sidecar.createIndex('record', ['scope', 'generation', 'recordKey'])
      }
    ]
  ])('rejects an owned sidecar with %s', async (_label, configure) => {
    await expectInvalidInstallation(createMalformedSidecarStore(`r05-sidecar-${_label}`, configure))
  })

  it('rejects a valid sidecar with an extra owned index', async () => {
    await expectInvalidInstallation(
      createMalformedSidecarStore('r05-sidecar-rogue', (sidecar) => {
        sidecar.createIndex('lookup', ['scope', 'indexName', 'generation', 'indexValue'])
        sidecar.createIndex('record', ['scope', 'generation', 'recordKey'])
        sidecar.createIndex('rogue', ['scope'])
      })
    )
  })

  it('invalidates every migrated canonical scope in one legacy batch', async () => {
    const factory = new IDBFactory()
    const dbName = 'r05-legacy-two-scope'
    await new Promise<void>((resolve, reject) => {
      const request = factory.open(dbName, 1)
      request.onupgradeneeded = () => {
        const database = request.result
        database.createObjectStore('kv')
        database.createObjectStore('bytes')
        database.createObjectStore('records')
        database.createObjectStore('__storage_web_revisions__')
        const metadata = database.createObjectStore('__storage_web_meta__')
        const sidecar = database.createObjectStore('storage-plugin-browser:index-records', {
          keyPath: ['scope', 'indexName', 'generation', 'indexValue', 'recordKey']
        })
        sidecar.createIndex('lookup', ['scope', 'indexName', 'generation', 'indexValue'])
        sidecar.createIndex('record', ['scope', 'generation', 'recordKey'])
        const legacy = database.createObjectStore('documents')
        const keyA = ['__storage_web_entity_v2__', 'a', 'id-a']
        const keyB = ['__storage_web_entity_v2__', 'b', 'id-b']
        legacy.put({ __v: 1, data: { id: 'id-a' } }, keyA)
        legacy.put({ __v: 1, data: { id: 'id-b' } }, keyB)
        metadata.put(
          {
            handle: { scope: 'a', generation: 'ga', fingerprint: '[]' },
            currentGeneration: 'ga',
            readiness: { status: 'complete', scanned: 2, indexed: 2 }
          },
          ['__storage_web_internal__', 'index', 'a']
        )
        metadata.put(
          {
            handle: { scope: 'b', generation: 'gb', fingerprint: '[]' },
            currentGeneration: 'gb',
            readiness: { status: 'complete', scanned: 2, indexed: 2 }
          },
          ['__storage_web_internal__', 'index', 'b']
        )
        sidecar.put({
          scope: 'a',
          indexName: 'value',
          generation: 'ga',
          indexValue: 'x',
          recordKey: keyA
        })
        sidecar.put({
          scope: 'b',
          indexName: 'value',
          generation: 'gb',
          indexValue: 'x',
          recordKey: keyB
        })
      }
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    const store = await createInstalledStore({ factory, keyRange: IDBKeyRange, dbName })
    await expect(store.get('probe')).resolves.toBeNull()
    for (const scope of ['a', 'b'])
      await expect(
        store
          .iterateRecordIndex({
            handle: { scope, generation: `g${scope}`, fingerprint: '[]' },
            index: 'value'
          })
          .next()
      ).rejects.toMatchObject({ code: 'INDEX_BACKFILL_STALE' })
    await store.dispose()
  })

  it.each([
    ['first', ['', 'legacy']],
    ['middle', ['__storage_web_entity_v2__', 'ab']],
    ['last', ['zz', 'legacy']]
  ])('classifies mixed legacy authority when unscoped key is %s', async (label, unscopedKey) => {
    const { store, handles, initialReadiness } = await createMixedLegacyStore(
      `r05-legacy-order-${label}`,
      [
        ['__storage_web_entity_v2__', 'a', 'id-a'],
        unscopedKey,
        ['__storage_web_entity_v2__', 'b', 'id-b']
      ]
    )
    expect(initialReadiness).toEqual([
      { status: 'complete', scanned: 1, indexed: 1 },
      { status: 'complete', scanned: 1, indexed: 1 }
    ])
    await expect(store.get('probe')).resolves.toBeNull()
    // This per-scope postcondition is failure-sensitive: without all-scope invalidation, one handle
    // remains complete for at least one mixed ordering instead of both becoming stale.
    for (const handle of handles)
      await expect(store.getRecordIndexReadiness(handle)).rejects.toMatchObject({
        code: 'INDEX_BACKFILL_STALE'
      })
    await store.dispose()
  })

  it('leases index preparation through dispose', async () => {
    const store = await createStore('r05-prepare-dispose-race')
    const tracker = await trackMutationLeases(store)
    const preparation = store.ensureRecordIndexes('users', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    await store.dispose()
    await expect(preparation).resolves.toMatchObject({ scope: 'users' })
    expect(tracker.counts()).toEqual({ admissions: 1, releases: 1 })
  })

  it('drains an accepted non-cooperative callback before releasing disposal', async () => {
    const store = await createStore('r05-transaction-deadline')
    const tracker = await trackMutationLeases(store)
    const controller = (await store.api.controller())!
    const entered = deferred<void>()
    const release = deferred<void>()
    let callbackEnded = false
    const transaction = store.transaction(async () => {
      entered.resolve()
      await release.promise
      callbackEnded = true
    })
    const result = transaction.catch((cause: unknown) => cause)
    await entered.promise
    const firstDispose = store.dispose()
    expect(store.dispose()).toBe(firstDispose)
    let disposed = false
    void firstDispose.then(() => {
      disposed = true
    })
    expect(controller.closingSignal.aborted).toBe(true)
    expect(callbackEnded).toBe(false)
    expect(disposed).toBe(false)
    expect(tracker.counts()).toEqual({ admissions: 1, releases: 0 })
    release.resolve()
    await expect(result).resolves.toMatchObject({ code: 'STORE_DISPOSED' })
    await firstDispose
    expect(callbackEnded).toBe(true)
    expect(tracker.counts()).toEqual({ admissions: 1, releases: 1 })
  })
})
