import { indexedDbTestFeatures } from '../helpers/indexed-db-features.js'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { ttl, kv } from '@migaia/storage-contract'
import { createManualScheduler } from '@migaia/utils/testing'
import { createStorageHost } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'

/** The real public installation owns native transactions, scopes and cleanup for every TTL case. */
async function setup() {
  const scheduler = createManualScheduler()
  const host = await createStorageHost({
    scheduler,
    plugins: [
      indexedDbBackendPlugin(
        {
          factory: new IDBFactory(),
          keyRange: IDBKeyRange,
          dbName: `ttl-${crypto.randomUUID()}`
        },
        indexedDbTestFeatures
      )
    ]
  })
  onTestFinished(() => host.dispose())
  return { scheduler, host, store: host.backend('indexed-db') }
}

describe('native IndexedDB TTL', () => {
  it('expires every native data channel before point reads, enumeration and cross-channel conflicts', async () => {
    const { scheduler, store } = await setup()
    const expiry = store.use(ttl)
    await store.set('text', 'value')
    await store.setBytes('bytes', new Uint8Array([1]))
    await store.putRecord({ value: 1 }, 'record')
    await store.set('enumerated', 'expired')
    await store.putRecord({ value: 2 }, 'enumerated-record')
    await store.set('displaced', 'expired')
    await expiry.expire({ channel: 'text', key: 'text' }, 10)
    await expiry.expire({ channel: 'bytes', key: 'bytes' }, 10)
    await expiry.expire({ channel: 'record', key: 'record' }, 10)
    await expiry.expire({ channel: 'text', key: 'enumerated' }, 10)
    await expiry.expire({ channel: 'record', key: 'enumerated-record' }, 10)
    await expiry.expire({ channel: 'text', key: 'displaced' }, 10)
    scheduler.advance(11)
    await expect(store.setBytes('displaced', new Uint8Array([3]))).resolves.toBeUndefined()
    await expect(store.get('text')).resolves.toBeNull()
    await expect(store.has('text')).resolves.toBe(false)
    await expect(store.keys()).resolves.toEqual([])
    await expect(store.getBytes('bytes')).resolves.toBeNull()
    await expect(store.getRecord('record')).resolves.toBeUndefined()
    const rows: unknown[] = []
    for await (const row of store.iterateRecords()) rows.push(row)
    expect(rows).toEqual([])
    await expect(store.setBytes('text', new Uint8Array([2]))).resolves.toBeUndefined()
    await expect(store.set('bytes', 'reused')).resolves.toBeUndefined()
    await expect(store.set('record', 'reused')).resolves.toBeUndefined()
  })

  it('writes batch deadlines in the same original native transaction and rolls TTL drafts back', async () => {
    const { store } = await setup()
    await store.use(kv).setMany([{ key: 'immediate', value: 'gone', ttlMs: 0 }])
    await expect(store.get('immediate')).resolves.toBeNull()
    await store.set('kept', 'original')
    const rollback = new Error('rollback native TTL draft')
    await expect(
      store.transaction(async (scope) => {
        await scope.use(ttl).expire({ channel: 'text', key: 'kept' }, 0)
        await scope.set('new', 'discarded')
        throw rollback
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    await expect(store.get('kept')).resolves.toBe('original')
    await expect(store.get('new')).resolves.toBeNull()
    await expect(
      store.use(ttl).remaining({ channel: 'text', key: 'kept' })
    ).resolves.toBeUndefined()
  })

  it('removes expired indexed records through the original sidecar, revision and post-commit paths', async () => {
    const { scheduler, store } = await setup()
    const repository = defineEntity<{ id: string; score: number }>()({
      name: 'ttl-index',
      key: 'id',
      indexes: { score: { path: 'score' } }
    }).connect(store)
    await repository.put({ id: 'expired', score: 1 })
    await repository.migrate()
    await expect(repository.query().index('score').all()).resolves.toEqual([
      { id: 'expired', score: 1 }
    ])
    const scan = vi.spyOn(store, 'iterateRecords')
    const changes: string[] = []
    const stop = store.subscribeChanges((event) => {
      changes.push(event.channel + ':' + event.kind)
    })
    await store.use(ttl).expire({ channel: 'record', key: repository.lockKey('expired').key }, 10)
    scheduler.advance(11)
    await expect(repository.query().index('score').all()).resolves.toEqual([])
    expect(scan).not.toHaveBeenCalled()
    expect(changes).toContain('record:remove')
    stop()
  })

  it('persists a native deadline across real default-clock host reopening', async () => {
    const factory = new IDBFactory()
    const dbName = `ttl-reopen-${crypto.randomUUID()}`
    const first = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({ factory, keyRange: IDBKeyRange, dbName }, indexedDbTestFeatures)
      ]
    })
    const firstStore = first.backend('indexed-db')
    await firstStore.set('kept', 'value')
    await firstStore.use(ttl).expire({ channel: 'text', key: 'kept' }, 60_000)
    await first.dispose()
    const second = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({ factory, keyRange: IDBKeyRange, dbName }, indexedDbTestFeatures)
      ]
    })
    onTestFinished(() => second.dispose())
    const secondStore = second.backend('indexed-db')
    const remaining = await secondStore.use(ttl).remaining({ channel: 'text', key: 'kept' })
    expect(remaining).toBeDefined()
    expect(remaining! > 0 && remaining! <= 60_000).toBe(true)
    await expect(secondStore.get('kept')).resolves.toBe('value')
    await expect(secondStore.use(ttl).persist({ channel: 'text', key: 'kept' })).resolves.toBe(true)
  })
})
