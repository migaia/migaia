import { storageJournalPlugin } from '@migaia/storage-host/plugins/journal'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { binlogPlugin, undoLogPlugin, walPlugin, memoryLogStore } from '@migaia/log-plugin-durable'
import { kv, ttl } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '../src/index.ts'
import { nodeSqliteDriver } from '../src/node.ts'

/** Each read path must append only its real expiry mutation through the original native journal. */
it.each([
  'get',
  'has',
  'keys',
  'getBytes',
  'getRecord',
  'getMany',
  'remaining',
  'iterator'
] as const)(
  'journals lazy expiry from the original %s read and restores its raw deadline with undo',
  async (method) => {
    const connection = nodeSqliteDriver(':memory:')
    const logger = createLogHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      plugins: [
        walPlugin({ store: memoryLogStore() }),
        binlogPlugin({ store: memoryLogStore() }),
        undoLogPlugin({ store: memoryLogStore() })
      ]
    })
    const host = await createStorageHost({
      plugins: [
        storageJournalPlugin({ logger, namespace: 'expiry', binlogValues: true }),
        sqliteBackendPlugin({ driver: connection })
      ] as const
    })
    onTestFinished(async () => {
      vi.restoreAllMocks()
      await host.dispose()
      await logger.shutdown('manual')
      await connection.dispose()
    })
    const store = host.backend('sqlite')
    const channel =
      method === 'getBytes'
        ? 'bytes'
        : method === 'getRecord' || method === 'iterator'
          ? 'record'
          : 'text'
    if (channel === 'bytes') await store.setBytes('expired', new Uint8Array([1, 2]))
    else if (channel === 'record') await store.putRecord({ value: 'expired' }, 'expired')
    else await store.set('expired', 'expired')
    await store.use(ttl).expire({ channel, key: 'expired' }, 1000)
    const seq = await logger.binlog.lastSeq()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 2000)
    if (method === 'get') expect(await store.get('expired')).toBeNull()
    else if (method === 'has') expect(await store.has('expired')).toBe(false)
    else if (method === 'keys') expect(await store.keys()).toEqual([])
    else if (method === 'getBytes') expect(await store.getBytes('expired')).toBeNull()
    else if (method === 'getRecord') expect(await store.getRecord('expired')).toBeUndefined()
    else if (method === 'getMany')
      expect(await store.use(kv).getMany(['expired'])).toEqual([undefined])
    else if (method === 'remaining')
      expect(await store.use(ttl).remaining({ channel: 'text', key: 'expired' })).toBeUndefined()
    else {
      const iterator = store.iterateRecords()
      expect(await iterator.next()).toMatchObject({ done: true })
      await iterator.dispose()
    }
    expect(await logger.binlog.lastSeq()).toBe(seq + 1)
    const entry = (await logger.binlog.read(seq + 1))[0]!.payload as {
      txId: string
      changes: Array<{ target: { channel: string }; present: boolean }>
    }
    expect(entry.changes).toHaveLength(1)
    expect(entry.changes[0]).toMatchObject({ target: { channel }, present: false })
    expect(
      connection
        .prepare('SELECT count(*) AS n FROM migaia_' + (channel === 'record' ? 'records' : channel))
        .get()!.n
    ).toBe(0)
    await store.undo(entry.txId)
    const restored = connection
      .prepare('SELECT expires_at FROM migaia_' + (channel === 'record' ? 'records' : channel))
      .get()
    expect(restored!.expires_at).toBeLessThan(Date.now())
  }
)
