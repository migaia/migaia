import { storageProbe } from '../src/plugins/probe/index.js'
import { storageJournalPlugin } from '../src/journal.js'
import { memoryNotificationsFeature } from '../src/features/memory-notifications.js'
import { memoryChangeFeedFeature } from '../src/features/memory-change-feed.js'
import { describe, expect, it } from 'vitest'
import { Logger } from '@migaia/logger'
import { deferred } from '@migaia/utils/promise'
import {
  binlog,
  undoLog,
  memoryLogStore,
  LogRecordState,
  type ILogStore
} from '@migaia/logger/plugins/durable'
import { blob, counter, kv, rdf, ttl, vector } from '@migaia/storage-contract'
import { lockKey } from '../src/authoring/concurrency.js'
import { term } from '../src/authoring/rdf.js'
import { createOrgId, createStorageHost, memoryBackendPlugin } from '../src/index.js'

/** Real durable scheduling keeps failures observable without writing test diagnostics to stdout. */
const runtimeManager = {
  randomUUID: () => crypto.randomUUID(),
  defer: (task: () => void) => queueMicrotask(task),
  write: () => undefined
}
/** Existing durable plugins require their original explicit unbounded execution budget. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
/** Each fixture borrows two authentic stores through the real installed durable plugins. */
const createJournalLogger = (records: ILogStore, images: ILogStore) =>
  new Logger({
    execution,
    runtimeManager,
    plugins: [binlog({ store: records }), undoLog({ store: images })]
  })

describe('global native storage journal', () => {
  it('prepares the final installation batch once per org and joins root writes to original scoped commits', async () => {
    const loggers = new Map<string, ReturnType<typeof createJournalLogger>>()
    const logs = new Map<string, ILogStore>()
    const initialized: string[] = []
    await using host = await createStorageHost({
      plugins: [
        storageProbe(),
        storageJournalPlugin(async ({ orgId, storageLogStore }) => {
          initialized.push(orgId)
          const records = await storageLogStore('memory', { prefix: 'binlog' })
          const images = await storageLogStore('memory', { prefix: 'undo' })
          const logger = createJournalLogger(records, images)
          loggers.set(orgId, logger)
          logs.set(orgId, records)
          return {
            logger,
            namespace: 'application',
            atomicBinlog: { memory: records },
            atomicUndo: { memory: images }
          }
        }),
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    try {
      expect(initialized).toHaveLength(1)
      const store = host.backend('memory')
      await store.set('text', 'one')
      await store.setBytes('bytes', new Uint8Array([1, 2]))
      await store.putRecord({ value: 1 }, 'record')
      expect(await store.use(counter).increment('counter', 2)).toBe(2)
      expect(await store.use(ttl).expire(lockKey.text('text'), 100_000)).toBe(true)
      await store.transaction(async (scope) => {
        await scope.set('text', 'two')
        await scope.set('text', 'three')
      })
      const logger = loggers.get(initialized[0]!)!
      const records = await logger.binlog.read(1)
      expect(records).toHaveLength(6)
      const last = records.at(-1)!.payload as { txId: string; changes: unknown[] }
      expect(last.changes).toHaveLength(2)
      expect(await logger.undo.get(last.txId)).toHaveLength(1)
      const original = new RangeError('rollback global native work')
      await expect(
        store.transaction(async (scope) => {
          await scope.set('text', 'rollback')
          throw original
        })
      ).rejects.toMatchObject({ cause: original })
      expect(await store.get('text')).toBe('three')
      expect(await logs.get(initialized[0]!)!.lastSeq()).toBe(6)
      expect(await store.get('text')).toBe('three')
      let pulls = 0
      const body = new ReadableStream<Uint8Array>(
        {
          pull: () => {
            pulls++
          }
        },
        { highWaterMark: 0 }
      )
      await expect(store.use(blob).put('object', body)).rejects.toMatchObject({
        code: 'UNSUPPORTED_CAPABILITY'
      })
      expect(body.locked).toBe(false)
      expect(pulls).toBe(0)
      /** The original bootstrap stage rejects every public sync writer before its terminal. */
      for (const write of [
        () => store.sync.set('sync', 'cannot bypass selected journal'),
        () => store.sync.remove('text'),
        () => store.sync.clearValues()
      ])
        expect(write).toThrowError(expect.objectContaining({ code: 'ASYNC_STAGE_IN_SYNC_ENTRY' }))
      expect(await store.get('text')).toBe('three')
      expect(await store.get('sync')).toBeNull()
      expect(await logs.get(initialized[0]!)!.lastSeq()).toBe(6)
      const orgId = createOrgId()
      const org = host.org(orgId).backend('memory')
      expect(initialized).toHaveLength(1)
      expect(await org.get('text')).toBeNull()
      expect(initialized.filter((value) => value === orgId)).toHaveLength(1)
      await Promise.all([org.set('text', 'org'), org.set('second', 'org')])
      expect(initialized.filter((value) => value === orgId)).toHaveLength(1)
      expect(await org.get('text')).toBe('org')
      expect(await store.get('text')).toBe('three')
      expect(await logs.get(orgId)!.lastSeq()).toBe(2)
      await host.dropOrg(orgId)
      const stale = logs.get(orgId)!
      await expect(stale.lastSeq()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(stale.read(1, 10)).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(stale.states(LogRecordState.pending)).rejects.toMatchObject({
        code: 'STORE_DISPOSED'
      })
      await expect(
        org.set('after-drop', 'must not commit without a current log')
      ).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      expect(await org.get('after-drop')).toBeNull()
      expect(await logs.get(initialized[0]!)!.lastSeq()).toBe(6)
      expect(initialized.filter((value) => value === orgId)).toHaveLength(1)
    } finally {
      for (const logger of loggers.values()) await logger.shutdown('manual')
    }
  })

  it('records actual capacity victims before index publication and keeps metadata out of entry limits', async () => {
    let logger: ReturnType<typeof createJournalLogger> | undefined
    const evicted: number[] = []
    const entered = deferred<void>()
    const resume = deferred<void>()
    let pause = false
    await using host = await createStorageHost({
      plugins: [
        storageProbe(),
        storageJournalPlugin(async ({ storageLogStore }) => {
          const records = await storageLogStore('memory', { prefix: 'capacity-binlog' })
          const images = await storageLogStore('memory', { prefix: 'capacity-undo' })
          logger = createJournalLogger(records, images)
          const original = logger
          /** A supported borrowed logger facade delays the real already-started native append. */
          const binlog = {
            ...original.binlog,
            append: async (...args: Parameters<typeof original.binlog.append>) => {
              const result = await original.binlog.append(...args)
              if (pause) {
                pause = false
                entered.resolve()
                await resume.promise
              }
              return result
            }
          }
          const borrowed = {
            dispatchRaw: original.dispatchRaw,
            onFailure: original.onFailure,
            hook: original.hook,
            flush: original.flush,
            defer: original.defer,
            binlog,
            undo: original.undo
          }
          return {
            logger: borrowed,
            namespace: 'capacity',
            atomicBinlog: { memory: records },
            atomicUndo: { memory: images }
          }
        }),
        memoryBackendPlugin(
          { capacity: { maxEntries: 2, eviction: 'lru' } },
          {
            notifications: memoryNotificationsFeature(),
            changeFeed: memoryChangeFeedFeature()
          }
        )
      ]
    })
    try {
      host.extensions.observe('onEvict', (event) => {
        evicted.push(event.count)
      })
      const store = host.backend('memory')
      await store.set('a', 'a')
      await store.set('b', 'b')
      pause = true
      const pending = expect(store.set('c', 'c')).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
      await entered.promise
      expect(await logger!.binlog.read(1)).toHaveLength(2)
      expect(await store.get('a')).toBe('a')
      resume.resolve()
      await pending
      expect(await store.get('c')).toBeNull()
      expect(await logger!.binlog.read(1)).toHaveLength(2)
      expect(evicted).toEqual([])
      await store.set('c', 'c')
      expect(await store.use(kv).keys()).toEqual(['a', 'c'])
      expect(evicted).toEqual([1])
      const last = (await logger!.binlog.read(3))[0]!.payload as {
        txId: string
        changes: unknown[]
      }
      expect(last.changes).toHaveLength(2)
      const images = await logger!.undo.get(last.txId)
      expect(images).toHaveLength(2)
      expect(
        images!.filter((image) => !(image.after as { present: boolean }).present)
      ).toHaveLength(1)
    } finally {
      await logger?.shutdown('manual')
    }
  })

  it('rolls back an initializer failure through the original batch and closes its private handles', async () => {
    let acquired: ILogStore | undefined
    const original = new RangeError('global initializer failed after opening its private namespace')
    await expect(
      createStorageHost({
        plugins: [
          storageProbe(),
          storageJournalPlugin(async ({ storageLogStore }) => {
            acquired = await storageLogStore('memory', { prefix: 'failed-initializer' })
            throw original
          }),
          memoryBackendPlugin(undefined, {
            notifications: memoryNotificationsFeature(),
            changeFeed: memoryChangeFeedFeature()
          })
        ]
      })
    ).rejects.toMatchObject({ code: 'BACKEND_INSTALL_FAILED', cause: { cause: original } })
    await expect(acquired!.lastSeq()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
  })

  it('captures each native clear image while retaining original channel epochs and one clear event', async () => {
    let logger: ReturnType<typeof createJournalLogger> | undefined
    await using host = await createStorageHost({
      plugins: [
        storageProbe(),
        storageJournalPlugin(async ({ storageLogStore }) => {
          const records = await storageLogStore('memory', { prefix: 'clear-binlog' })
          const images = await storageLogStore('memory', { prefix: 'clear-undo' })
          logger = createJournalLogger(records, images)
          return {
            logger,
            namespace: 'clear',
            atomicBinlog: { memory: records },
            atomicUndo: { memory: images }
          }
        }),
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    try {
      const store = host.backend('memory')
      await store.set('text', 'value')
      await store.setBytes('bytes', new Uint8Array([4]))
      await store.putRecord(null, 'record')
      const collection = store.use(vector).collection('vectors', { dimensions: 1, metric: 'dot' })
      await collection.upsert([{ id: 'one', vector: [1] }])
      await store.use(rdf).add([
        {
          subject: term.iri('urn:a'),
          predicate: term.iri('urn:p'),
          object: term.iri('urn:b'),
          graph: term.defaultGraph
        }
      ])
      const changes: string[] = []
      const unsubscribe = store.subscribeChanges((change) => {
        changes.push(change.kind)
      })
      await store.clearValues()
      expect(changes).toEqual(['clear'])
      expect(await store.getBytes('bytes')).toEqual(new Uint8Array([4]))
      const clearedText = (await logger!.binlog.read(6))[0]!.payload as { txId: string }
      const textImages = await logger!.undo.get(clearedText.txId)
      expect(textImages).toHaveLength(1)
      expect(textImages![0]!.target).toMatchObject({ afterRevision: { epoch: 1, revision: 0 } })
      changes.length = 0
      await store.clearAll()
      expect(changes).toEqual(['clear'])
      const clearedAll = (await logger!.binlog.read(7))[0]!.payload as {
        txId: string
        changes: unknown[]
      }
      expect(clearedAll.changes).toHaveLength(4)
      const images = await logger!.undo.get(clearedAll.txId)
      expect(images).toHaveLength(4)
      for (const image of images!) {
        expect(image.target).toMatchObject({ afterRevision: { epoch: 1, revision: 0 } })
        expect(image.after).toEqual({ present: false })
      }
      expect(await collection.search([1], { k: 1 })).toEqual([])
      expect(await store.use(rdf).match({}).count()).toBe(0)
      await store.clearAll()
      expect(await logger!.binlog.read(1)).toHaveLength(7)
      unsubscribe()
    } finally {
      await logger?.shutdown('manual')
    }
  })
})

describe('external storage binlog', () => {
  it('waits for commit-only append and reports its failure without reversing committed data', async () => {
    await using records = memoryLogStore()
    const logger = new Logger({ execution, runtimeManager, plugins: [binlog({ store: records })] })
    const entered = deferred<void>()
    const release = deferred<void>()
    const original = new RangeError('external durable append failed after commit')
    const reports: unknown[] = []
    const failures: unknown[] = []
    let calls = 0
    const borrowed = {
      dispatchRaw: logger.dispatchRaw,
      onFailure: logger.onFailure,
      hook: logger.hook,
      flush: logger.flush,
      defer: logger.defer,
      binlog: {
        ...logger.binlog,
        append: async <T>(
          kind: string,
          payload: T & import('@migaia/logger/plugins/durable').ILogPayloadInput<T>
        ) => {
          calls++
          if (calls === 1) {
            entered.resolve()
            await release.promise
            throw original
          }
          return logger.binlog.append(kind, payload)
        }
      }
    }
    await using host = await createStorageHost({
      plugins: [
        storageProbe({
          onBinlogAppendError: (event) => {
            failures.push(event)
          }
        }),
        storageJournalPlugin({ logger: borrowed, namespace: 'external' }),
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ],
      report: (error) => {
        reports.push(error)
      }
    })
    try {
      const store = host.backend('memory')
      let complete = false
      const pending = store.set('key', 'committed').then(() => {
        complete = true
      })
      await entered.promise
      expect(await store.get('key')).toBe('committed')
      expect(complete).toBe(false)
      release.resolve()
      await pending
      expect(reports).toEqual([original])
      expect(failures).toEqual([
        expect.objectContaining({
          namespace: 'external',
          backendInstanceId: 'memory',
          orgId: expect.any(String)
        })
      ])
      await store.set('key', 'next')
      expect(await logger.binlog.read(1)).toHaveLength(1)
      expect(calls).toBe(2)
    } finally {
      release.resolve()
      await logger.shutdown('manual')
    }
  })
})
