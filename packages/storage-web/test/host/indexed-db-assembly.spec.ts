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
        expect(invoke).toThrowError(
          expect.objectContaining({
            source: STORAGE_WEB_SOURCE,
            code: StorageErrorCode.indexedDbFeatureNotInstalled
          })
        )
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
