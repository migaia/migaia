import { ignoreLogFailure } from './helpers/log-observer.ts'
import { storageJournalPlugin } from '../src/journal.ts'
import { describe, expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { binlogPlugin, undoLogPlugin, type ILogStore } from '@migaia/log-plugin-durable'
import { lockKey } from '../src/authoring/concurrency.ts'
import { ttl, vector, rdf } from '@migaia/storage-contract'
import { term } from '../src/authoring/rdf.ts'
import { createOrgId, createStorageHost } from '../src/index.ts'
import { memoryBackendPlugin } from '../src/plugins/memory.ts'

/** This fixture does not add a second timeout or logger lifecycle owner. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
/** A real same-registration logger carries native binlog and final undo images. */
const createLogger = (records: ILogStore, images: ILogStore) =>
  createLogHost({
    execution,
    report: ignoreLogFailure,
    plugins: [binlogPlugin({ store: records }), undoLogPlugin({ store: images })]
  })

/** Every organization keeps its own original data/log namespace and borrowed logger lifetime. */
async function fixture() {
  const loggers = new Map<string, ReturnType<typeof createLogger>>()
  const host = await createStorageHost({
    plugins: [
      storageJournalPlugin(async ({ orgId, storageLogStore }) => {
        const records = await storageLogStore('memory', { prefix: 'undo-binlog' })
        const images = await storageLogStore('memory', { prefix: 'undo-images' })
        const logger = createLogger(records, images)
        loggers.set(orgId, logger)
        return {
          logger,
          namespace: 'undo',
          atomicBinlog: { memory: records },
          atomicUndo: { memory: images }
        }
      }),
      memoryBackendPlugin()
    ]
  })
  return {
    host,
    loggers,
    close: async () => {
      await host.dispose()
      for (const logger of loggers.values()) await logger.shutdown('manual')
    }
  }
}

/** Committed ids come from the actual log, not a user-supplied transaction-shaped object. */
async function lastTx(logger: ReturnType<typeof createLogger>): Promise<string> {
  const [record] = await logger.binlog.read(await logger.binlog.lastSeq())
  return (record!.payload as { txId: string }).txId
}

describe('original native storage undo', () => {
  it('restores first-before images and absence/null/bytes/TTL through one new native commit', async () => {
    const current = await fixture()
    try {
      const store = current.host.backend('memory')
      const logger = [...current.loggers.values()][0]!
      await store.set('text', 'before')
      await store.setBytes('bytes', new Uint8Array([1]))
      await store.putRecord(null, 'nullable')
      await store
        .tx()
        .lock(
          lockKey.text('text'),
          lockKey.text('missing'),
          lockKey.bytes('bytes'),
          lockKey.record('nullable')
        )
        .run(async (scope) => {
          await scope.set('text', 'middle')
          await scope.set('text', 'after')
          await scope.use(ttl).expire({ channel: 'text', key: 'text' }, 60_000)
          await scope.set('missing', 'created')
          await scope.setBytes('bytes', new Uint8Array([2]))
          await scope.deleteRecord('nullable')
        })
      const txId = await lastTx(logger)
      const previous = await logger.binlog.lastSeq()
      const result = await store.undo(txId, { timeoutMs: 60_000 })
      expect(result.txId).not.toBe(txId)
      expect(await store.get('text')).toBe('before')
      expect(await store.get('missing')).toBeNull()
      expect(await store.getBytes('bytes')).toEqual(new Uint8Array([1]))
      expect(await store.getRecord('nullable')).toBeNull()
      expect(await store.use(ttl).remaining({ channel: 'text', key: 'text' })).toBeUndefined()
      expect(await logger.binlog.lastSeq()).toBe(previous + 1)
      expect(await logger.undo.get(result.txId)).toBeDefined()
      const restoredImages = (await logger.undo.get(result.txId))!
      await logger.undo.record('duplicate-owned-target', [restoredImages[0]!, restoredImages[0]!])
      await expect(store.undo('duplicate-owned-target')).rejects.toMatchObject({
        code: 'JOURNAL_RECORD_INVALID'
      })
      expect(await store.get('text')).toBe('before')
      await expect(store.undo(txId)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
      await expect(store.undo('unknown')).rejects.toMatchObject({ code: 'UNDO_NOT_FOUND' })
      const vectors = store.use(vector).collection('undo-vectors', { dimensions: 1, metric: 'dot' })
      await vectors.upsert([{ id: 'point', vector: [1] }])
      await vectors.upsert([{ id: 'point', vector: [2] }])
      await store.undo(await lastTx(logger))
      expect((await vectors.search([1], { k: 1 }))[0]!.score).toBe(1)
      await store.use(rdf).add([
        {
          subject: term.iri('urn:s'),
          predicate: term.iri('urn:p'),
          object: term.iri('urn:o'),
          graph: term.defaultGraph
        }
      ])
      await store.undo(await lastTx(logger))
      expect(await store.use(rdf).match({}).count()).toBe(0)
    } finally {
      await current.close()
    }
  })

  it('checks all targets before restore and rejects ABA, clear epochs and a second net-zero undo', async () => {
    const current = await fixture()
    try {
      const store = current.host.backend('memory')
      const logger = [...current.loggers.values()][0]!
      await store.set('one', 'old-one')
      await store.set('two', 'old-two')
      await store
        .tx()
        .lock(lockKey.text('one'), lockKey.text('two'))
        .run(async (scope) => {
          await scope.set('one', 'new-one')
          await scope.set('two', 'new-two')
        })
      const both = await lastTx(logger)
      await store.set('two', 'other')
      await expect(store.undo(both)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
      expect(await store.get('one')).toBe('new-one')
      await store.set('two', 'new-two')
      await expect(store.undo(both)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
      await store.set('net-zero', 'same')
      await store
        .tx()
        .lock(lockKey.text('net-zero'))
        .run(async (scope) => {
          await scope.set('net-zero', 'different')
          await scope.set('net-zero', 'same')
        })
      const netZero = await lastTx(logger)
      const results = await Promise.allSettled([store.undo(netZero), store.undo(netZero)])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      await expect(store.undo(netZero)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
      const beforeClear = await lastTx(logger)
      await store.clearValues()
      await store.set('net-zero', 'same')
      await expect(store.undo(beforeClear)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
    } finally {
      await current.close()
    }
  })

  it('keeps borrowed org undo fixed and rejects a foreign durable target before business writes', async () => {
    const current = await fixture()
    try {
      const first = createOrgId()
      const second = createOrgId()
      const left = current.host.org(first).backend('memory')
      const right = current.host.org(second).backend('memory')
      await left.set('key', 'left')
      await right.set('key', 'right')
      const logger = current.loggers.get(first)!
      const txId = await lastTx(logger)
      const undo = left.undo
      await current.loggers.get(second)!.undo.record(txId, (await logger.undo.get(txId))!)
      await expect(right.undo(txId)).rejects.toMatchObject({ code: 'JOURNAL_RECORD_INVALID' })
      expect(await right.get('key')).toBe('right')
      await undo(txId)
      expect(await left.get('key')).toBeNull()
      expect(await right.get('key')).toBe('right')
      expect('dispose' in left).toBe(false)
    } finally {
      await current.close()
    }
  })
})
