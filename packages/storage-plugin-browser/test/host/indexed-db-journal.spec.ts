import { indexedDbTestFeatures } from '../helpers/indexed-db-features.ts'
// @vitest-environment node
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createOrgId, createStorageHost } from '@migaia/storage-host'
import { storageLogStore, storageJournalPlugin } from '@migaia/storage-host/plugins/journal'
import { LogRecordState } from '@migaia/log-plugin-durable'
import { walkErrorCauses } from '@migaia/utils/error'
import { indexedDbBackendPlugin } from '../../src/indexed-db.ts'

describe('native IndexedDB private journal namespaces', () => {
  it('uses native readwrite transactions for independent nonexclusive persistent handles', async () => {
    const factory = new IDBFactory()
    vi.stubGlobal('indexedDB', factory)
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('BroadcastChannel', undefined)
    try {
      const wrapper: IDBFactory = {
        open: (name, version) => factory.open(name, version),
        deleteDatabase: (name) => factory.deleteDatabase(name),
        databases: () => factory.databases(),
        cmp: (first, second) => factory.cmp(first, second)
      }
      await using host = await createStorageHost({
        plugins: [
          storageJournalPlugin(),
          indexedDbBackendPlugin(
            { keyRange: IDBKeyRange, dbName: 'no-web-locks' },
            indexedDbTestFeatures
          )
        ]
      })
      await using peer = await createStorageHost({
        plugins: [
          storageJournalPlugin(),
          indexedDbBackendPlugin(
            {
              factory: wrapper,
              keyRange: IDBKeyRange,
              dbName: 'no-web-locks'
            },
            indexedDbTestFeatures
          )
        ]
      })
      const one = await storageLogStore(host, 'indexed-db', { prefix: 'history' })
      const two = await storageLogStore(peer, 'indexed-db', { prefix: 'history' })
      try {
        const batches = await Promise.all(
          Array.from({ length: 10 }, (_, index) =>
            (index % 2 === 0 ? one : two).append([{ kind: 'shared', payload: index }])
          )
        )
        expect(batches.flat().sort((a, b) => a - b)).toEqual(
          Array.from({ length: 10 }, (_, index) => index + 1)
        )
        expect(await one.lastSeq()).toBe(10)
        expect(await two.states(LogRecordState.pending)).toEqual(
          Array.from({ length: 10 }, (_, index) => index + 1)
        )
        await one.setState(1, LogRecordState.done)
        expect(await two.states(LogRecordState.pending)).toEqual(
          Array.from({ length: 9 }, (_, index) => index + 2)
        )
        expect(await host.backend('indexed-db').keys()).toEqual([])
      } finally {
        await Promise.all([one.dispose(), two.dispose()])
      }
      await using reopened = await storageLogStore(peer, 'indexed-db', { prefix: 'history' })
      expect((await reopened.read(1, 20)).map((row) => row.seq)).toEqual(
        Array.from({ length: 10 }, (_, index) => index + 1)
      )
      expect(await reopened.states(LogRecordState.pending)).toEqual(
        Array.from({ length: 9 }, (_, index) => index + 2)
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps private history across business clear and reopening with isolated orgs and prefixes', async () => {
    const factory = new IDBFactory()
    await using host = await createStorageHost({
      plugins: [
        storageJournalPlugin(),
        indexedDbBackendPlugin(
          {
            factory,
            keyRange: IDBKeyRange,
            dbName: 'journal',
            journalFactoryIsPrivate: true
          },
          indexedDbTestFeatures
        )
      ]
    })
    const first = host.org(createOrgId())
    const second = host.org(createOrgId())
    const root = await storageLogStore(host, 'indexed-db', { prefix: 'history' })
    await using otherPrefix = await storageLogStore(host, 'indexed-db', { prefix: 'history/' })
    await using one = await storageLogStore(first, 'indexed-db', { prefix: 'history' })
    await using two = await storageLogStore(second, 'indexed-db', { prefix: 'history' })
    try {
      await root.append([{ kind: 'root', payload: { present: true } }])
      await one.append([{ kind: 'first', payload: null }])
      await two.append([{ kind: 'second', payload: null }])
      await otherPrefix.append([{ kind: 'prefix', payload: null }])
      const store = host.backend('indexed-db')
      await store.set('business', 'value')
      await store.metadata!.set('history', 'public metadata')
      await store.clearAll()
      expect(await store.keys()).toEqual([])
      expect((await root.read(1, 10)).map((row) => row.kind)).toEqual(['root'])
      expect((await one.read(1, 10)).map((row) => row.kind)).toEqual(['first'])
      expect((await two.read(1, 10)).map((row) => row.kind)).toEqual(['second'])
      expect((await otherPrefix.read(1, 10)).map((row) => row.kind)).toEqual(['prefix'])
      await root.setState(1, LogRecordState.done)
      await root.truncate(2)
      await root.dispose()
      await using reopened = await storageLogStore(host, 'indexed-db', { prefix: 'history' })
      expect(await reopened.lastSeq()).toBe(1)
      expect(await reopened.read(1, 10)).toEqual([])
      expect(await reopened.append([{ kind: 'next', payload: null }])).toEqual([2])
      expect(await reopened.states(LogRecordState.pending)).toEqual([2])
    } finally {
      await root.dispose()
    }
  })

  it('keeps the committed index unchanged when the actual native transaction aborts', async () => {
    const factory = new IDBFactory()
    await using host = await createStorageHost({
      plugins: [
        storageJournalPlugin(),
        indexedDbBackendPlugin(
          {
            factory,
            keyRange: IDBKeyRange,
            dbName: 'abort',
            journalFactoryIsPrivate: true
          },
          indexedDbTestFeatures
        )
      ]
    })
    const log = await storageLogStore(host, 'indexed-db', { prefix: 'history' })
    const notices: unknown[] = []
    log.onAppend((notice) => {
      notices.push(notice)
    })
    const original = new RangeError('actual native journal write abort')
    const put = IDBObjectStore.prototype.put
    const failure = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        if (Array.isArray(key) && key[1] === 'journal' && key[3] === 'head') {
          this.transaction.abort()
          throw original
        }
        return Reflect.apply(put, this, [value, key])
      })
    try {
      const rejected = await log
        .append([{ kind: 'aborted', payload: null }])
        .catch((error) => error)
      expect(walkErrorCauses(rejected)).toContain(original)
      expect(notices).toEqual([])
    } finally {
      failure.mockRestore()
    }
    await log.dispose()
    await using reopened = await storageLogStore(host, 'indexed-db', { prefix: 'history' })
    expect(await reopened.lastSeq()).toBe(0)
    expect(await reopened.read(1, 10)).toEqual([])
    expect(await reopened.append([{ kind: 'committed', payload: null }])).toEqual([1])
  })

  it('uses the original lifetime lease and invalidates cached reads after physical org deletion', async () => {
    const factory = new IDBFactory()
    const options = {
      factory,
      keyRange: IDBKeyRange,
      dbName: 'exclusive',
      journalFactoryIsPrivate: true as const
    }
    const orgId = createOrgId()
    await using host = await createStorageHost({
      org: orgId,
      plugins: [storageJournalPlugin(), indexedDbBackendPlugin(options, indexedDbTestFeatures)]
    })
    await using peer = await createStorageHost({
      org: orgId,
      plugins: [storageJournalPlugin(), indexedDbBackendPlugin(options, indexedDbTestFeatures)]
    })
    const log = await storageLogStore(host, 'indexed-db', { prefix: 'history' })
    await log.append([{ kind: 'old', payload: null }])
    await expect(storageLogStore(peer, 'indexed-db', { prefix: 'history' })).rejects.toMatchObject({
      code: 'LOCK_REJECTED'
    })
    const dispose = log.dispose()
    expect(log.dispose()).toBe(dispose)
    await dispose
    const replacement = await storageLogStore(peer, 'indexed-db', { prefix: 'history' })
    expect(await replacement.lastSeq()).toBe(1)
    await peer.dropOrg(orgId)
    await expect(replacement.lastSeq()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(replacement.states(LogRecordState.pending)).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await expect(replacement.append([{ kind: 'late', payload: null }])).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await replacement.dispose()
    await using reopened = await storageLogStore(peer, 'indexed-db', { prefix: 'history' })
    expect(await reopened.lastSeq()).toBe(0)
    expect(await peer.backend('indexed-db').get('business')).toBeNull()
  })
})
