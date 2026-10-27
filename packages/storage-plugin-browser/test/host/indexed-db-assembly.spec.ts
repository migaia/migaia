import { indexedDbKeysetFeature } from '../../src/features/indexed-db-keyset.js'
import { indexedDbIndexesFeature } from '../../src/features/indexed-db-indexes.js'
import { indexedDbJournalFeature } from '../../src/features/indexed-db-journal.js'
import { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/journal'
import { walkErrorCauses } from '@migaia/utils/error'
import { IDBFactory, IDBIndex, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BroadcastChannel as NativeBroadcastChannel } from 'node:worker_threads'
import { Logger } from '@migaia/logger'
import { binlog, undoLog } from '@migaia/logger/plugins/durable'
import { createStorageHost } from '@migaia/storage-host'
import {
  kv,
  records,
  ttl,
  StorageContractErrorCode,
  STORAGE_CONTRACT_SOURCE
} from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { indexedDbTtlFeature } from '../../src/features/indexed-db-ttl.js'
import { indexedDbBatchFeature } from '../../src/features/indexed-db-batch.js'
import { indexedDbNotificationsFeature } from '../../src/features/indexed-db-notifications.js'
import { indexedDbChangeFeedFeature } from '../../src/features/indexed-db-change-feed.js'
import { StorageErrorCode, STORAGE_BROWSER_SOURCE } from '../../src/types/errors.js'

/** Each case uses the real public plugin and its original native transaction owner. */
const options = () => ({ factory: new IDBFactory(), keyRange: IDBKeyRange })

/**
 * Native method observers never replace the engine and are released after each public operation
 * case.
 */
afterEach(() => vi.restoreAllMocks())

/** Keep the real durable plugin tuple so its public binlog and undo extensions stay typed. */
function createAssemblyLogger(
  records: Parameters<typeof binlog>[0]['store'],
  images: Parameters<typeof undoLog>[0]['store']
) {
  return new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [binlog({ store: records }), undoLog({ store: images })]
  })
}

describe('explicit IndexedDB assembly', () => {
  it('keeps basic storage independent and rejects undeclared optional operations', async () => {
    /** Original IndexedDB ports prove the borrowed view actually reads and writes its engine. */
    const nativePut = vi.spyOn(IDBObjectStore.prototype, 'put')
    /** Original reads remain observable independently of returned business values. */
    const nativeGet = vi.spyOn(IDBObjectStore.prototype, 'get')
    /** Records iteration must use the engine cursor rather than a client-side value cache. */
    const nativeCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
    const host = await createStorageHost({ plugins: [indexedDbBackendPlugin(options())] })
    const store = host.backend('indexed-db')
    nativePut.mockClear()
    nativeGet.mockClear()
    nativeCursor.mockClear()
    try {
      await store.set('key', 'value')
      expect(await store.get('key')).toBe('value')
      await store.putRecord({ value: 1 }, 'row')
      expect(await store.getRecord('row')).toEqual({ value: 1 })
      expect(await store.use(records).query().all()).toHaveLength(1)
      await expect(store.use(records).query().page(1)).rejects.toMatchObject({
        source: STORAGE_BROWSER_SOURCE,
        code: StorageErrorCode.indexedDbFeatureNotInstalled,
        message: expect.stringContaining('indexedDbKeysetFeature')
      })
      expect(await store.transaction((scope) => scope.getRecord('row'))).toEqual({ value: 1 })
      expect(nativePut).toHaveBeenCalled()
      expect(nativeGet).toHaveBeenCalled()
      expect(nativeCursor).toHaveBeenCalled()
      expect(store.capabilities.batch).toBe(false)
      expect(store.capabilities.secondaryIndexes).toBe(false)
      expect(store.capabilities.changeFeed).toBe(false)
      expect(store.has(ttl)).toBe(false)
      expect(() => store.use(ttl)).toThrowError(
        expect.objectContaining({
          source: STORAGE_CONTRACT_SOURCE,
          code: StorageContractErrorCode.unsupported,
          message: expect.stringContaining('ttl')
        })
      )
      for (const invoke of [
        () => store.use(kv).getMany(['key']),
        () => store.ensureRecordIndexes('scope', []),
        () => store.watch('key'),
        () => store.subscribeChanges(() => undefined),
        () => store.undo!('missing')
      ]) {
        await expect(Promise.resolve().then<unknown>(() => invoke())).rejects.toMatchObject({
          source: STORAGE_BROWSER_SOURCE,
          code: StorageErrorCode.indexedDbFeatureNotInstalled
        })
      }
    } finally {
      await host.dispose()
    }
  })

  it('installs TTL independently of batches, journal and notifications', async () => {
    /** Immediate expiry removes the physical point through the original IndexedDB delete port. */
    const nativeDelete = vi.spyOn(IDBObjectStore.prototype, 'delete')
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { ttl: indexedDbTtlFeature() })]
    })
    const store = host.backend('indexed-db')
    nativeDelete.mockClear()
    try {
      expect(store.has(ttl)).toBe(true)
      expect(store.capabilities.batch).toBe(false)
      await store.set('key', 'value')
      expect(await store.use(ttl).expire({ channel: 'text', key: 'key' }, 0)).toBe(true)
      expect(await store.get('key')).toBeNull()
      expect(nativeDelete).toHaveBeenCalled()
    } finally {
      await host.dispose()
    }
  })

  it('installs native batches without granting TTL or change feeds', async () => {
    /** Observe the existing write port while leaving native transaction behavior intact. */
    const nativePut = vi.spyOn(IDBObjectStore.prototype, 'put')
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { batch: indexedDbBatchFeature() })]
    })
    const store = host.backend('indexed-db')
    nativePut.mockClear()
    try {
      expect(store.capabilities.batch).toBe(true)
      expect(store.has(ttl)).toBe(false)
      await store.use(kv).setMany([
        { key: 'a', value: '1' },
        { key: 'b', value: '2' }
      ])
      expect(await store.use(kv).getMany(['b', 'a', 'b'])).toEqual(['2', '1', '2'])
      expect(nativePut).toHaveBeenCalled()
      expect(() => store.subscribeChanges(() => undefined)).toThrowError(
        expect.objectContaining({
          source: STORAGE_BROWSER_SOURCE,
          code: StorageErrorCode.indexedDbFeatureNotInstalled,
          message: expect.stringContaining('indexedDbNotificationsFeature')
        })
      )
      await expect(
        store.use(kv).setMany([{ key: 'ttl-missing', value: 'not-written', ttlMs: 1 }])
      ).rejects.toMatchObject({
        source: STORAGE_BROWSER_SOURCE,
        code: StorageErrorCode.indexedDbFeatureNotInstalled,
        message: expect.stringContaining('indexedDbTtlFeature')
      })
      expect(await store.get('ttl-missing')).toBeNull()
    } finally {
      await host.dispose()
    }
  })

  it('publishes after native commit only when notifications are selected', async () => {
    /** Notifications must follow a real physical write, including the rollback control below. */
    const nativePut = vi.spyOn(IDBObjectStore.prototype, 'put')
    const host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(options(), { notifications: indexedDbNotificationsFeature() })
      ]
    })
    const store = host.backend('indexed-db')
    const changes: string[] = []
    const stop = store.subscribeChanges((change) => changes.push(change.kind))
    nativePut.mockClear()
    try {
      await store.set('key', 'value')
      expect(changes).toEqual(['put'])
      expect(nativePut).toHaveBeenCalled()
      expect(() => store.watch('key')).toThrowError(
        expect.objectContaining({
          source: STORAGE_BROWSER_SOURCE,
          code: StorageErrorCode.indexedDbFeatureNotInstalled,
          message: expect.stringContaining('indexedDbChangeFeedFeature')
        })
      )
      /** A failed native transaction cannot publish the draft that its callback wrote. */
      const primary = new Error('rollback notification draft')
      await expect(
        store.transaction(async (scope) => {
          await scope.set('key', 'discarded')
          throw primary
        })
      ).rejects.toMatchObject({
        source: STORAGE_BROWSER_SOURCE,
        code: StorageErrorCode.transactionFailed,
        cause: primary
      })
      expect(await store.get('key')).toBe('value')
      expect(changes).toEqual(['put'])
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
      expect(() => host.backend('indexed-db').watch('key')).toThrowError(
        expect.objectContaining({
          source: STORAGE_BROWSER_SOURCE,
          code: StorageErrorCode.indexedDbFeatureNotInstalled,
          message: expect.stringContaining('indexedDbNotificationsFeature')
        })
      )
    } finally {
      await host.dispose()
    }
  })
  it('delivers committed changes with explicit notifications and feed after realm admission', async () => {
    /**
     * Native metadata transport remains the selected notification producer, without polling
     * fallback.
     */
    const nativePost = vi.spyOn(NativeBroadcastChannel.prototype, 'postMessage')
    /** Reuse the native Node transport; no second fake event owner is introduced. */
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('BroadcastChannel', NativeBroadcastChannel)
    try {
      await using host = await createStorageHost({
        plugins: [
          indexedDbBackendPlugin(
            { keyRange: IDBKeyRange },
            {
              notifications: indexedDbNotificationsFeature(),
              changeFeed: indexedDbChangeFeedFeature()
            }
          )
        ]
      })
      /** Only selected producers and iterators can expose the admitted public feed. */
      const store = host.backend('indexed-db')
      expect(store.capabilities.changeFeed).toBe(true)
      expect(store.capabilities.batch).toBe(false)
      expect(store.capabilities.secondaryIndexes).toBe(false)
      await using changes = store.watch('selected')
      /** The original iterator filters unrelated committed keys rather than polling data. */
      const next = changes.next()
      nativePost.mockClear()
      await store.set('other', 'ignored')
      await store.set('selected', 'committed')
      expect((await next).value).toMatchObject({
        channel: 'value',
        kind: 'put',
        keys: ['selected']
      })
      expect(await store.get('selected')).toBe('committed')
      expect(nativePost).toHaveBeenCalledWith(expect.objectContaining({ kind: 'put' }))
      await changes.dispose()
      expect(await changes.next()).toMatchObject({ done: true })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/** Independent assemblies keep their original native owners without selecting unrelated Features. */
describe('independent IndexedDB native owners', () => {
  it('uses canonical raw keyset pagination only when its independent Feature is selected', async () => {
    /** The page source must reach the original IndexedDB cursor port. */
    const nativeCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
    await using host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { keyset: indexedDbKeysetFeature() })]
    })
    /** The native store retains the original committed record owner. */
    const store = host.backend('indexed-db')
    await store.putRecord({ value: 1 }, 'one')
    await store.putRecord({ value: 2 }, 'two')
    nativeCursor.mockClear()
    /** One persistent query owns the cursor source identity across its successive branches. */
    const query = store.use(records).query()
    /** The first page provides the canonical opaque cursor without borrowing another source. */
    const first = await query.page(1)
    expect(first.items).toEqual([{ value: 1 }])
    expect(first.next).toBeDefined()
    expect((await query.after(first.next!).page(1)).items).toEqual([{ value: 2 }])
    expect(nativeCursor).toHaveBeenCalled()
    expect(store.capabilities.secondaryIndexes).toBe(false)
  })

  it('uses native index projection and cursor with only its indexes Feature', async () => {
    /** The secondary-index source must execute an engine index cursor. */
    const nativeIndexCursor = vi.spyOn(IDBIndex.prototype, 'openCursor')
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
    nativeIndexCursor.mockClear()
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
    expect(nativeIndexCursor).toHaveBeenCalled()
  })

  it('opens native log namespaces with only the journal Feature', async () => {
    /** Append/read must persist through the original engine rather than a process-local log. */
    const nativePut = vi.spyOn(IDBObjectStore.prototype, 'put')
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
    nativePut.mockClear()
    await log.append([{ kind: 'created', payload: { id: 'one' } }])
    expect((await log.read(1, 1))[0]?.kind).toBe('created')
    expect(nativePut).toHaveBeenCalled()
  })

  it('identifies the missing backend journal Feature before configured global journal preparation', async () => {
    const failure = await createStorageHost({
      plugins: [
        storageJournalPlugin(() => {
          throw new RangeError('journal initializer must not run without the native Feature')
        }),
        indexedDbBackendPlugin(options())
      ]
    }).catch((error: unknown) => error)
    expect([...walkErrorCauses(failure)]).toContainEqual(
      expect.objectContaining({
        source: STORAGE_BROWSER_SOURCE,
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
        source: STORAGE_BROWSER_SOURCE,
        code: StorageErrorCode.indexedDbFeatureNotInstalled,
        message: expect.stringContaining('indexedDbJournalFeature')
      })
    )
  })
})

it('captures and undoes native images with journal alone while leaving TTL and notifications absent', async () => {
  /** The real durable plugins use the original native private namespaces. */
  let logger: ReturnType<typeof createAssemblyLogger> | undefined
  await using host = await createStorageHost({
    plugins: [
      storageJournalPlugin(async ({ storageLogStore }) => {
        /** The original private log namespace stores committed business steps. */
        const records = await storageLogStore('indexed-db', { prefix: 'assembly-binlog' })
        /** Undo images remain in their own original durable namespace. */
        const images = await storageLogStore('indexed-db', { prefix: 'assembly-undo' })
        logger = createAssemblyLogger(records, images)
        return {
          logger,
          namespace: 'journal-only',
          indexedDbUndo: true,
          atomicBinlog: { 'indexed-db': records },
          atomicUndo: { 'indexed-db': images },
          binlogValues: true
        }
      }),
      indexedDbBackendPlugin(
        { ...options(), journalFactoryIsPrivate: true },
        { journal: indexedDbJournalFeature() }
      )
    ]
  })
  try {
    /** Without TTL or notifications, images still use the canonical physical point revisions. */
    const store = host.backend('indexed-db')
    expect(store.has(ttl)).toBe(false)
    expect(store.capabilities.changeFeed).toBe(false)
    await store.set('key', 'committed')
    /** Only the public durable log supplies the actual committed transaction identity. */
    const commit = (await logger!.binlog.read(1))[0]!.payload as { txId: string }
    expect(await logger!.undo.get(commit.txId)).toHaveLength(1)
    await store.undo(commit.txId)
    expect(await store.get('key')).toBeNull()
    expect(await logger!.binlog.read(1)).toHaveLength(2)
  } finally {
    await logger?.shutdown('manual')
  }
})
