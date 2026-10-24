import { indexedDbKeysetFeature } from '../../src/features/indexed-db-keyset.js'
import { indexedDbIndexesFeature } from '../../src/features/indexed-db-indexes.js'
import { indexedDbJournalFeature } from '../../src/features/indexed-db-journal.js'
import { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/journal'
import { walkErrorCauses } from '@migaia/utils/error'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { kv, records, ttl } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { indexedDbTtlFeature } from '../../src/features/indexed-db-ttl.js'
import { indexedDbBatchFeature } from '../../src/features/indexed-db-batch.js'
import { indexedDbNotificationsFeature } from '../../src/features/indexed-db-notifications.js'
import { indexedDbChangeFeedFeature } from '../../src/features/indexed-db-change-feed.js'
import { StorageErrorCode, STORAGE_WEB_SOURCE } from '../../src/types/errors.js'

/** Each case uses the real public plugin and its original native transaction owner. */
const options = () => ({ factory: new IDBFactory(), keyRange: IDBKeyRange })

describe('explicit IndexedDB assembly', () => {
  it('keeps basic storage independent and rejects undeclared optional operations', async () => {
    const host = await createStorageHost({ plugins: [indexedDbBackendPlugin(options())] })
    const store = host.backend('indexed-db')
    try {
      await store.set('key', 'value')
      expect(await store.get('key')).toBe('value')
      await store.putRecord({ value: 1 }, 'row')
      expect(await store.getRecord('row')).toEqual({ value: 1 })
      expect(await store.use(records).query().all()).toHaveLength(1)
      await expect(store.use(records).query().page(1)).rejects.toMatchObject({
        source: STORAGE_WEB_SOURCE,
        code: StorageErrorCode.indexedDbFeatureNotInstalled,
        message: expect.stringContaining('indexedDbKeysetFeature')
      })
      expect(await store.transaction((scope) => scope.getRecord('row'))).toEqual({ value: 1 })
      expect(store.capabilities.batch).toBe(false)
      expect(store.capabilities.secondaryIndexes).toBe(false)
      expect(store.capabilities.changeFeed).toBe(false)
      expect(store.has(ttl)).toBe(false)
      expect(() => store.use(ttl)).toThrowError(/ttl/)
      for (const invoke of [
        () => store.use(kv).getMany(['key']),
        () => store.ensureRecordIndexes('scope', []),
        () => store.watch('key'),
        () => store.subscribeChanges(() => undefined),
        () => store.undo!('missing')
      ]) {
        await expect(Promise.resolve().then<unknown>(() => invoke())).rejects.toMatchObject({
          source: STORAGE_WEB_SOURCE,
          code: StorageErrorCode.indexedDbFeatureNotInstalled
        })
      }
    } finally {
      await host.dispose()
    }
  })

  it('installs TTL independently of batches, journal and notifications', async () => {
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { ttl: indexedDbTtlFeature() })]
    })
    const store = host.backend('indexed-db')
    try {
      expect(store.has(ttl)).toBe(true)
      expect(store.capabilities.batch).toBe(false)
      await store.set('key', 'value')
      expect(await store.use(ttl).expire({ channel: 'text', key: 'key' }, 0)).toBe(true)
      expect(await store.get('key')).toBeNull()
    } finally {
      await host.dispose()
    }
  })

  it('installs native batches without granting TTL or change feeds', async () => {
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { batch: indexedDbBatchFeature() })]
    })
    const store = host.backend('indexed-db')
    try {
      expect(store.capabilities.batch).toBe(true)
      expect(store.has(ttl)).toBe(false)
      await store.use(kv).setMany([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' }
      ])
      expect(await store.use(kv).getMany(['b', 'a', 'b'])).toEqual(['2', '1', '2'])
      expect(() => store.subscribeChanges(() => undefined)).toThrowError(/NotificationsFeature/)
    } finally {
      await host.dispose()
    }
  })

  it('publishes after native commit only when notifications are selected', async () => {
    const host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(options(), { notifications: indexedDbNotificationsFeature() })
      ]
    })
    const store = host.backend('indexed-db')
    const changes: string[] = []
    const stop = store.subscribeChanges((change) => changes.push(change.kind))
    try {
      await store.set('key', 'value')
      expect(changes).toEqual(['put'])
      expect(() => store.watch('key')).toThrowError(/ChangeFeedFeature/)
    } finally {
      stop()
      await host.dispose()
    }
  })

  it('does not install notification prerequisites implicitly for change feeds', async () => {
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { changeFeed: indexedDbChangeFeedFeature() })]
    })
    try {
      expect(() => host.backend('indexed-db').watch('key')).toThrowError(/NotificationsFeature/)
    } finally {
      await host.dispose()
    }
  })
})

/** Independent assemblies keep their original native owners without selecting unrelated Features. */
describe('independent IndexedDB native owners', () => {
  it('uses canonical raw keyset pagination only when its independent Feature is selected', async () => {
    await using host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { keyset: indexedDbKeysetFeature() })]
    })
    /** The native store retains the original committed record owner. */
    const store = host.backend('indexed-db')
    await store.putRecord({ value: 1 }, 'one')
    await store.putRecord({ value: 2 }, 'two')
    /** One persistent query owns the cursor source identity across its successive branches. */
    const query = store.use(records).query()
    /** The first page provides the canonical opaque cursor without borrowing another source. */
    const first = await query.page(1)
    expect(first.items).toEqual([{ value: 1 }])
    expect(first.next).toBeDefined()
    expect((await query.after(first.next!).page(1)).items).toEqual([{ value: 2 }])
    expect(store.capabilities.secondaryIndexes).toBe(false)
  })

  it('uses native index projection and cursor with only its indexes Feature', async () => {
    await using host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { indexes: indexedDbIndexesFeature() })]
    })
    const store = host.backend('indexed-db')
    expect(store.capabilities.secondaryIndexes).toBe(true)
    expect(store.capabilities.batch).toBe(false)
    expect(store.has(ttl)).toBe(false)
    const handle = await store.ensureRecordIndexes('users', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    const rows = await store.transactionIndexed(handle, async (scope) => {
      await scope.putIndexedRecord({ id: 'u1', email: 'a@example.test' }, 'u1', handle, {
        email: { kind: 'single', key: 'a@example.test' }
      })
      const rows: unknown[] = []
      for await (const row of scope.iterateRecordIndex({
        handle,
        index: 'email',
        range: { lower: 'a@example.test', upper: 'a@example.test' }
      }))
        rows.push(row)
      return rows
    })
    expect(rows).toEqual([['u1', { id: 'u1', email: 'a@example.test' }]])
  })

  it('opens native log namespaces with only the journal Feature', async () => {
    await using host = await createStorageHost({
      plugins: [
        storageJournalPlugin(),
        indexedDbBackendPlugin(options(), { journal: indexedDbJournalFeature() })
      ]
    })
    const store = host.backend('indexed-db')
    expect(store.capabilities.batch).toBe(false)
    expect(store.capabilities.secondaryIndexes).toBe(false)
    expect(store.has(ttl)).toBe(false)
    await using log = await storageLogStore(host, 'indexed-db', { prefix: 'explicit-journal' })
    await log.append([{ kind: 'created', payload: { id: 'one' } }])
    expect((await log.read(1, 1))[0]?.kind).toBe('created')
  })

  it('identifies the missing backend journal Feature before configured global journal preparation', async () => {
    const failure = await createStorageHost({
      plugins: [storageJournalPlugin(), indexedDbBackendPlugin(options())],
      journal: () => {
        throw new RangeError('journal initializer must not run without the native Feature')
      }
    }).catch((error: unknown) => error)
    expect([...walkErrorCauses(failure)]).toContainEqual(
      expect.objectContaining({
        source: STORAGE_WEB_SOURCE,
        code: StorageErrorCode.indexedDbFeatureNotInstalled,
        message: expect.stringContaining('indexedDbJournalFeature')
      })
    )
  })

  it('identifies the missing backend journal Feature on standalone namespace calls', async () => {
    await using host = await createStorageHost({
      plugins: [storageJournalPlugin(), indexedDbBackendPlugin(options())]
    })
    /** Recovery keeps its original wrapper while the cause identifies the missing native unit. */
    const failure = await storageLogStore(host, 'indexed-db', { prefix: 'missing' }).catch(
      (error: unknown) => error
    )
    expect([...walkErrorCauses(failure)]).toContainEqual(
      expect.objectContaining({
        source: STORAGE_WEB_SOURCE,
        code: StorageErrorCode.indexedDbFeatureNotInstalled,
        message: expect.stringContaining('indexedDbJournalFeature')
      })
    )
  })
})
