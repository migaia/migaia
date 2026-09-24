import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { indexedDbHost } from '../../src/backends/indexed-db.js'
import { getBackendReactiveController } from '../../src/backends/reactive-controller.js'

/** Opens a database with one deliberately forgeable public metadata record. */
const createStore = (dbName: string) => {
  const factory = new IDBFactory()
  return indexedDbHost({ factory, keyRange: IDBKeyRange, dbName })
}

/** Counts lifecycle admissions and releases without changing the controller's behavior. */
const trackMutationLeases = (store: ReturnType<typeof createStore>) => {
  const controller = getBackendReactiveController(store)!
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
      const sidecar = database.createObjectStore('storage-web:index-records', {
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
  return indexedDbHost({ factory, keyRange: IDBKeyRange, dbName })
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
      const metadata = database.createObjectStore('storage-web:meta')
      const sidecar = database.createObjectStore('storage-web:index-records', {
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
  const preflightStore = indexedDbHost({ factory, keyRange: IDBKeyRange, dbName })
  const initialReadiness = await Promise.all(
    handles.map((handle) => preflightStore.getRecordIndexReadiness(handle))
  )
  await preflightStore.dispose()
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(dbName, 2)
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
    store: indexedDbHost({ factory, keyRange: IDBKeyRange, dbName }),
    handles,
    initialReadiness
  }
}

describe('SWV4-R05 IndexedDB preparation and mutation ownership', () => {
  it('ignores public schema and index strings as backend authority', async () => {
    const store = createStore('r05-public-forge')
    await store.get('probe')
    await store.metadata!.set('schema', { version: 999, migration: 'forged' })
    await store.metadata!.set('index:users', {
      handle: { scope: 'users', generation: 'forged', fingerprint: 'forged' },
      readiness: { status: 'complete', scanned: 99, indexed: 99 }
    })

    const reopened = createStore('r05-public-forge')
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

  it('waits for an admitted record write before closing and rejects late writes', async () => {
    const store = createStore('r05-dispose-race')
    const tracker = trackMutationLeases(store)
    const write = store.putRecord({ value: 1 }, 'record-1')
    await store.dispose()
    await expect(write).resolves.toBe('record-1')
    expect(tracker.counts()).toEqual({ admissions: 1, releases: 1 })
    await expect(store.putRecord({ value: 2 }, 'record-2')).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
  })

  it('latches an incompatible native layout as a terminal preparation failure', async () => {
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
    const store = indexedDbHost({ factory, keyRange: IDBKeyRange, dbName })
    await expect(store.get('probe')).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(store.get('probe-again')).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await store.dispose()
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
    const store = await createMalformedSidecarStore(`r05-sidecar-${_label}`, configure)
    await expect(store.get('probe')).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(store.get('probe-again')).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await store.dispose()
  })

  it('rejects a valid sidecar with an extra owned index', async () => {
    const store = await createMalformedSidecarStore('r05-sidecar-rogue', (sidecar) => {
      sidecar.createIndex('lookup', ['scope', 'indexName', 'generation', 'indexValue'])
      sidecar.createIndex('record', ['scope', 'generation', 'recordKey'])
      sidecar.createIndex('rogue', ['scope'])
    })
    await expect(store.get('probe')).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(store.get('probe-again')).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await store.dispose()
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
        const sidecar = database.createObjectStore('storage-web:index-records', {
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
    const store = indexedDbHost({ factory, keyRange: IDBKeyRange, dbName })
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
    const store = createStore('r05-prepare-dispose-race')
    const tracker = trackMutationLeases(store)
    const preparation = store.ensureRecordIndexes('users', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    await store.dispose()
    await expect(preparation).resolves.toMatchObject({ scope: 'users' })
    expect(tracker.counts()).toEqual({ admissions: 1, releases: 1 })
  })

  it('bounds a non-cooperative transaction callback so dispose can finish', async () => {
    const store = createStore('r05-transaction-deadline')
    const tracker = trackMutationLeases(store)
    const transaction = store.transaction(async () => new Promise<never>(() => {}), {
      timeoutMs: 25
    })
    const firstDispose = store.dispose()
    const secondDispose = store.dispose()
    expect(firstDispose).toBe(secondDispose)
    await expect(transaction).rejects.toMatchObject({ code: 'ABORTED' })
    expect(tracker.counts()).toEqual({ admissions: 1, releases: 1 })
    await expect(
      Promise.race([
        firstDispose,
        new Promise((_, reject) => setTimeout(() => reject(new Error('dispose timeout')), 250))
      ])
    ).resolves.toBeUndefined()
  })
})
