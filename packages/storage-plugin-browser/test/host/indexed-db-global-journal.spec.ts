import { storageJournalPlugin } from '@migaia/storage-host/plugins/journal'
import { indexedDbTestFeatures } from '../helpers/indexed-db-features.js'
// @vitest-environment node
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { Logger } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'
import { binlog, undoLog } from '@migaia/logger/plugins/durable'
import { kv, ttl } from '@migaia/storage-contract'
import { lockKey, decodeFlatStorageKey } from '@migaia/storage-host/sdk'
import { createOrgId, createStorageHost } from '@migaia/storage-host'
import { createManualScheduler } from '@migaia/utils/testing'
import { indexedDbBlobFeature } from '../../src/features/blobs.js'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'

/** Only the original durable plugins and actual native private stores participate in the fixture. */
const createLogger = (
  records: Parameters<typeof binlog>[0]['store'],
  images: Parameters<typeof undoLog>[0]['store']
) =>
  new Logger({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    plugins: [binlog({ store: records }), undoLog({ store: images })]
  })

describe('global IndexedDB native journal', () => {
  it('keeps actual step order, commits native logs with data and restores through the original undo builder', async () => {
    const factory = new IDBFactory()
    let logger: ReturnType<typeof createLogger> | undefined
    await using host = await createStorageHost({
      plugins: [
        storageJournalPlugin(async ({ storageLogStore }) => {
          const records = await storageLogStore('indexed-db', { prefix: 'binlog' })
          const images = await storageLogStore('indexed-db', { prefix: 'undo' })
          logger = createLogger(records, images)
          return {
            logger,
            namespace: 'application',
            indexedDbUndo: true,
            atomicBinlog: { 'indexed-db': records },
            atomicUndo: { 'indexed-db': images },
            binlogValues: true
          }
        }),
        indexedDbBackendPlugin(
          {
            factory,
            keyRange: IDBKeyRange,
            dbName: 'global',
            journalFactoryIsPrivate: true
          },
          indexedDbTestFeatures
        )
      ]
    })
    try {
      const store = host.backend('indexed-db')
      await store.transaction(async (scope) => {
        await scope.set('a', 'one')
        await scope.setBytes('b', new Uint8Array([1, 2]))
        await scope.set('a', 'two')
        await scope.remove('a')
        await scope.set('a', 'final')
        await scope.putRecord({ title: 'draft' }, 'record')
      })
      const commits = await logger!.binlog.read(1)
      expect(commits).toHaveLength(1)
      const payload = commits[0]!.payload as {
        txId: string
        changes: Array<{ target: { channel: string; key: string } }>
      }
      expect(
        payload.changes.map((change) => [
          change.target.channel,
          decodeFlatStorageKey(change.target.key)
        ])
      ).toEqual([
        ['text', 'a'],
        ['bytes', 'b'],
        ['text', 'a'],
        ['text', 'a'],
        ['text', 'a'],
        ['record', 'record']
      ])
      expect(await logger!.undo.get(payload.txId)).toHaveLength(3)
      const original = new RangeError('abort actual native journal scope')
      await expect(
        store.transaction(async (scope) => {
          await scope.set('a', 'rolled back')
          throw original
        })
      ).rejects.toMatchObject({ cause: original })
      expect(await store.get('a')).toBe('final')
      expect(await logger!.binlog.read(1)).toHaveLength(1)
      await store.undo(payload.txId)
      expect(await store.get('a')).toBeNull()
      expect(await store.getBytes('b')).toBeNull()
      expect(await store.getRecord('record')).toBeUndefined()
      expect(await logger!.binlog.read(1)).toHaveLength(2)
    } finally {
      await logger?.shutdown('manual')
    }
  })

  it('preserves revisions across other contract writers and clear/recreate, rejecting ABA undo without a partial restore', async () => {
    const factory = new IDBFactory()
    const options = {
      factory,
      keyRange: IDBKeyRange,
      dbName: 'aba',
      journalFactoryIsPrivate: true as const
    }
    let logger: ReturnType<typeof createLogger> | undefined
    await using host = await createStorageHost({
      plugins: [
        storageJournalPlugin(async ({ storageLogStore }) => {
          const records = await storageLogStore('indexed-db', { prefix: 'binlog' })
          const images = await storageLogStore('indexed-db', { prefix: 'undo' })
          logger = createLogger(records, images)
          return {
            logger,
            namespace: 'application',
            indexedDbUndo: true,
            atomicBinlog: { 'indexed-db': records },
            atomicUndo: { 'indexed-db': images }
          }
        }),
        indexedDbBackendPlugin(options, indexedDbTestFeatures)
      ]
    })
    await using peer = await createStorageHost({
      plugins: [storageJournalPlugin(), indexedDbBackendPlugin(options, indexedDbTestFeatures)]
    })
    try {
      const store = host.backend('indexed-db')
      await store.set('a', 'final')
      const payload = (await logger!.binlog.read(1))[0]!.payload as { txId: string }
      await peer.backend('indexed-db').clearAll()
      await peer.backend('indexed-db').set('a', 'final')
      await expect(store.undo(payload.txId)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
      expect(await store.get('a')).toBe('final')
      expect(await logger!.binlog.read(1)).toHaveLength(1)
      await store.use(ttl).expire(lockKey.text('a'), 60_000)
      const expiry = (await logger!.binlog.read(2))[0]!.payload as { txId: string }
      await store.undo(expiry.txId)
      expect(await store.use(ttl).remaining(lockKey.text('a'))).toBeUndefined()
      expect(await store.get('a')).toBe('final')
    } finally {
      await logger?.shutdown('manual')
    }
  })
  it('prepares a fresh org on its first read and journals every lazy-expiry read through the original native owner', async () => {
    const scheduler = createManualScheduler()
    const loggers = new Map<string, ReturnType<typeof createLogger>>()
    await using host = await createStorageHost({
      scheduler,
      plugins: [
        storageJournalPlugin(async ({ orgId, storageLogStore }) => {
          const records = await storageLogStore('indexed-db', { prefix: 'binlog' })
          const images = await storageLogStore('indexed-db', { prefix: 'undo' })
          const logger = createLogger(records, images)
          loggers.set(orgId, logger)
          return {
            logger,
            namespace: 'application',
            indexedDbUndo: true,
            atomicBinlog: { 'indexed-db': records },
            atomicUndo: { 'indexed-db': images }
          }
        }),
        indexedDbBackendPlugin(
          {
            factory: new IDBFactory(),
            keyRange: IDBKeyRange,
            journalFactoryIsPrivate: true
          },
          indexedDbTestFeatures
        )
      ]
    })
    try {
      const orgId = createOrgId()
      const store = host.org(orgId).backend('indexed-db')
      expect(loggers.has(orgId)).toBe(false)
      expect(await store.get('empty')).toBeNull()
      const logger = loggers.get(orgId)!
      expect(logger).toBeDefined()
      expect(await logger.binlog.read(1)).toEqual([])
      await store.transaction(async (scope) => {
        for (const key of ['get', 'has', 'batch', 'keys']) {
          await scope.set(key, key)
          await scope.use(ttl).expire(lockKey.text(key), 10)
        }
        for (const key of ['bytes', 'remaining']) {
          await scope.setBytes(key, new Uint8Array([1]))
          await scope.use(ttl).expire(lockKey.bytes(key), 10)
        }
        for (const key of ['record', 'iterator']) {
          await scope.putRecord({ key }, key)
          await scope.use(ttl).expire(lockKey.record(key), 10)
        }
      })
      scheduler.advance(11)
      expect(await store.get('get')).toBeNull()
      expect(await store.use(kv).has('has')).toBe(false)
      expect(await store.use(kv).getMany(['batch'])).toEqual([undefined])
      expect(await store.keys()).toEqual([])
      expect(await store.getBytes('bytes')).toBeNull()
      expect(await store.getRecord('record')).toBeUndefined()
      const rows: unknown[] = []
      for await (const row of store.iterateRecords()) rows.push(row)
      expect(rows).toEqual([])
      expect(await store.use(ttl).remaining(lockKey.bytes('remaining'))).toBeUndefined()
      expect(await logger.binlog.read(1)).toHaveLength(9)
      const expiry = (await logger.binlog.read(2))[0]!.payload as { txId: string }
      const puts = vi.spyOn(IDBObjectStore.prototype, 'put')
      try {
        await store.undo(expiry.txId)
        expect(puts.mock.calls).toContainEqual(['get', 'get'])
        expect(
          puts.mock.calls.some(
            ([value]) =>
              typeof value === 'object' && value !== null && '__storage_web_expires_at__' in value
          )
        ).toBe(true)
      } finally {
        puts.mockRestore()
      }
      // The original absolute deadline is retained, so a later business read expires it again.
      expect(await store.get('get')).toBeNull()
      expect(await logger.binlog.read(1)).toHaveLength(11)
    } finally {
      for (const logger of loggers.values()) await logger.shutdown('manual')
    }
  })

  it('isolates raw native Features only for active commit journals, preserving telemetry-only clients', async () => {
    for (const active of [true, false]) {
      const telemetryLogger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [level()]
      })
      let logger: ReturnType<typeof createLogger> | undefined
      await using host = await createStorageHost({
        plugins: [
          storageJournalPlugin(async ({ storageLogStore }) => {
            if (!active) return { logger: telemetryLogger, namespace: 'telemetry', telemetry: true }
            const records = await storageLogStore('indexed-db', { prefix: 'binlog' })
            const images = await storageLogStore('indexed-db', { prefix: 'undo' })
            logger = createLogger(records, images)
            return {
              logger,
              namespace: 'application',
              indexedDbUndo: true,
              atomicBinlog: { 'indexed-db': records },
              atomicUndo: { 'indexed-db': images }
            }
          }),
          indexedDbBackendPlugin(
            { factory: new IDBFactory(), keyRange: IDBKeyRange, journalFactoryIsPrivate: true },
            { ...indexedDbTestFeatures, blobs: indexedDbBlobFeature() }
          )
        ]
      })
      try {
        const store = host.org(createOrgId()).backend('indexed-db')
        const work = store.api.blobs.put('blob', new Blob(['value']))
        if (active) {
          await expect(work).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
          await expect(
            store.transaction((scope) => scope.api.blobs.put('blob', new Blob(['value'])))
          ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
          expect(await logger!.binlog.read(1)).toEqual([])
        } else {
          await work
          expect(await (await store.api.blobs.get('blob'))!.text()).toBe('value')
        }
      } finally {
        await logger?.shutdown('manual')
        await telemetryLogger.shutdown('manual')
      }
    }
  })
})
