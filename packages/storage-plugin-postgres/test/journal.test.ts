import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import postgres from 'postgres'
import { it, expect, onTestFinished, describe } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { Logger } from '@migaia/logger'
import { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'
import { kv, vector, ttl, lockKey } from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { postgresJsDriver } from '../src/postgres-js.js'
import { pgvectorFeature } from '../src/features/pgvector.js'
import { decodePgJournalImage } from '../src/journal.js'
import { decodePgText } from '../src/codec.js'
/** The original borrowed logger owns append/index/cleanup; PostgreSQL owns only native changes. */
const loggerOptions = {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtimeManager: {
    randomUUID: () => crypto.randomUUID(),
    defer: (task: () => void) => queueMicrotask(task),
    write: () => undefined
  }
} as const
/** Native addresses must come from the same declared service wrapper as every other server case. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')

describe.each(['pg', 'postgres-js'] as const)('%s original global journal', (adapter) => {
  it('rejects an old undo after drop and recreation with the same value and local revision', async () => {
    const pool = new Pool({ connectionString })
    const client = postgres(connectionString!, { max: 8 })
    const driver = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
    const prefix = 'pg_drop_undo_' + randomUUID().slice(0, 8),
      org = randomUUID()
    const logger = new Logger({
      ...loggerOptions,
      plugins: [
        binlog({ store: memoryLogStore() }),
        wal({ store: memoryLogStore() }),
        undoLog({ store: memoryLogStore() })
      ]
    })
    const open = () =>
      createStorageHost({
        org,
        plugins: [postgresBackendPlugin({ driver, prefix })] as const,
        journal: { logger, namespace: 'drop-undo' }
      })
    // The package can already have an older private revisions layout; user data is retained.
    await pool.query(
      'CREATE TABLE ' +
        prefix +
        '_revisions (org_id text NOT NULL,key text NOT NULL,version bigint NOT NULL,PRIMARY KEY(org_id,key))'
    )
    await pool.query('INSERT INTO ' + prefix + '_revisions VALUES($1,$2,$3)', [
      org,
      'legacy-native-row',
      7n
    ])
    let host = await open()
    const migrated = (
      await pool.query(
        'SELECT version,birth::text AS birth FROM ' + prefix + '_revisions WHERE key=$1',
        ['legacy-native-row']
      )
    ).rows[0]!
    expect(migrated.version).toBe('7')
    expect(typeof migrated.birth).toBe('string')
    onTestFinished(async () => {
      await host.dispose()
      await logger.shutdown('manual')
      await pool.end()
      await client.end()
    })
    await host.backend('postgres').set('point', 'old-before')
    await host.backend('postgres').set('point', 'after')
    const txId = (
      (await logger.binlog.read(await logger.binlog.lastSeq()))[0]!.payload as { txId: string }
    ).txId
    await host.dropOrg(org)
    if (adapter === 'postgres-js') {
      await host.dispose()
      host = await open()
    }
    const store = host.org(org).backend('postgres')
    await store.set('point', 'new-before')
    await store.set('point', 'after')
    await expect(host.backend('postgres').undo(txId)).rejects.toMatchObject({
      code: 'UNDO_CONFLICT'
    })
    expect(await store.get('point')).toBe('after')
  })
  it('restores external undo images through the original locked native transaction and rejects ABA', async () => {
    const pool = new Pool({ connectionString })
    const client = postgres(connectionString!, { max: 8 })
    const driver = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
    const logger = new Logger({
      ...loggerOptions,
      plugins: [
        binlog({ store: memoryLogStore() }),
        wal({ store: memoryLogStore() }),
        undoLog({ store: memoryLogStore() })
      ]
    })
    const prefix = 'pg_undo_' + randomUUID().slice(0, 8),
      org = randomUUID()
    const host = await createStorageHost({
      org,
      plugins: [postgresBackendPlugin({ driver, prefix }, { vector: pgvectorFeature() })] as const,
      journal: { logger, namespace: 'external-undo' }
    })
    onTestFinished(async () => {
      await host.dispose()
      await logger.shutdown('manual')
      await pool.end()
      await client.end()
    })
    const store = host.backend('postgres')
    const lastTx = async () =>
      ((await logger.binlog.read(await logger.binlog.lastSeq()))[0]!.payload as { txId: string })
        .txId
    await store.set('text', 'before')
    await store.setBytes('bytes', new Uint8Array([1]))
    await store.putRecord(null, 'nullable')
    await store.use(ttl).expire(lockKey.text('text'), 60000)
    await store.transaction(async (scope) => {
      await scope.set('text', 'middle')
      await scope.set('text', 'after')
      await scope.use(ttl).expire(lockKey.text('text'), 120000)
      await scope.set('missing', 'created')
      await scope.setBytes('bytes', new Uint8Array([2]))
      await scope.deleteRecord('nullable')
    })
    const txId = await lastTx()
    let reads = 0
    const result = await store.undo(txId, {
      get timeoutMs() {
        reads += 1
        return 60000
      }
    })
    expect(reads).toBe(1)
    expect(result.txId).not.toBe(txId)
    expect(await store.get('text')).toBe('before')
    expect(await store.get('missing')).toBeNull()
    expect(await store.getBytes('bytes')).toEqual(new Uint8Array([1]))
    expect(await store.getRecord('nullable')).toBeNull()
    expect(await store.use(ttl).remaining(lockKey.text('text'))).toBeGreaterThan(0)
    expect(await store.use(ttl).remaining(lockKey.text('text'))).toBeLessThan(60000)
    expect(await logger.undo.get(result.txId)).toBeDefined()
    await expect(store.undo(txId)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
    const points = store.use(vector).collection('undo-points', { dimensions: 1, metric: 'dot' })
    await points.upsert([{ id: 'point', vector: [1] }])
    await points.upsert([{ id: 'point', vector: [2] }])
    await store.undo(await lastTx())
    expect((await points.near([1], { exact: true }).topK(1).all())[0]!.score).toBe(1)
    await store.metadata.set('version', { value: 1 })
    await store.metadata.set('version', { value: 2 })
    await store.undo(await lastTx())
    expect(await store.metadata.get('version')).toEqual({ value: 1 })
    await store.metadata.set('version', { value: 2 })
    const metadataTx = await lastTx()
    const ordinary = await createStorageHost({
      org,
      plugins: [postgresBackendPlugin({ driver, prefix })] as const
    })
    try {
      await ordinary.backend('postgres').metadata.set('version', { value: 3 })
      await ordinary.backend('postgres').metadata.set('version', { value: 2 })
    } finally {
      await ordinary.dispose()
    }
    await expect(store.undo(metadataTx)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
    const other = host.org(randomUUID()).backend('postgres')
    await other.set('org-only', 'value')
    const otherTx = await lastTx()
    await expect(store.undo(otherTx)).rejects.toMatchObject({ code: 'JOURNAL_RECORD_INVALID' })
    const borrowed = other.undo
    await borrowed(otherTx)
    expect(await other.get('org-only')).toBeNull()
    expect(await logger.wal.pending()).toEqual([])
  })
  it('recovers original external WAL after an append failure without losing native commit evidence', async () => {
    const pool = new Pool({ connectionString })
    const client = postgres(connectionString!, { max: 8 })
    const driver = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
    const logger = new Logger({
      ...loggerOptions,
      plugins: [binlog({ store: memoryLogStore() }), wal({ store: memoryLogStore() })]
    })
    let fail = true
    const original = new Error('external WAL append after native commit')
    const reports: unknown[] = []
    const borrowed = {
      ...logger,
      wal: logger.wal,
      binlog: {
        ...logger.binlog,
        append: async (...args: Parameters<typeof logger.binlog.append>) => {
          if (fail) throw original
          return logger.binlog.append(...args)
        }
      }
    }
    const prefix = 'pg_wal_' + randomUUID().slice(0, 8)
    const org = randomUUID()
    const open = () =>
      createStorageHost({
        org,
        plugins: [postgresBackendPlugin({ driver, prefix })] as const,
        journal: { logger: borrowed, namespace: 'external-wal' },
        report: (error) => {
          reports.push(error)
        }
      })
    let host = await open()
    onTestFinished(async () => {
      await host.dispose()
      await logger.shutdown('manual')
      await pool.end()
      await client.end()
    })
    await host.backend('postgres').set('key', 'committed')
    expect(await host.backend('postgres').get('key')).toBe('committed')
    expect(await logger.binlog.read(1)).toEqual([])
    expect(await logger.wal.pending()).toHaveLength(1)
    expect(reports).toEqual([original])
    expect((await pool.query('SELECT key FROM ' + prefix + '_commit_markers')).rows).toHaveLength(1)
    await host.dispose()
    fail = false
    host = await open()
    expect(await host.backend('postgres').get('key')).toBe('committed')
    expect(await logger.binlog.read(1)).toHaveLength(1)
    expect(await logger.wal.pending()).toEqual([])
    expect((await pool.query('SELECT key FROM ' + prefix + '_commit_markers')).rows).toEqual([])
    await host.backend('postgres').set('next', 'success')
    expect(await logger.binlog.read(1)).toHaveLength(2)
    expect(await logger.wal.pending()).toEqual([])
    await expect(
      host.backend('postgres').transaction(async (scope) => {
        await scope.set('rolled-back', 'draft')
        throw original
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: original })
    expect(await host.backend('postgres').get('rolled-back')).toBeNull()
    expect(await logger.binlog.read(1)).toHaveLength(2)
    expect(await logger.wal.pending()).toEqual([])
  })
  it('retains native cross-channel order and every intermediate value while undo merges targets', async () => {
    const pool = new Pool({ connectionString }),
      client = postgres(connectionString!, { max: 8 }),
      driver = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client),
      logger = new Logger({
        ...loggerOptions,
        plugins: [
          binlog({ store: memoryLogStore() }),
          wal({ store: memoryLogStore() }),
          undoLog({ store: memoryLogStore() })
        ]
      }),
      host = await createStorageHost({
        plugins: [
          postgresBackendPlugin(
            { driver, prefix: 'pg_order_' + randomUUID().slice(0, 8) },
            { vector: pgvectorFeature() }
          )
        ] as const,
        journal: { logger, namespace: 'ordered', binlogValues: true }
      }),
      store = host.backend('postgres'),
      points = store.use(vector).collection('points', { dimensions: 1, metric: 'dot' })
    onTestFinished(async () => {
      await host.dispose()
      await logger.shutdown('manual')
      await pool.end()
      await client.end()
    })
    await store.set('a', 'before')
    await points.upsert([{ id: 'v', vector: [0] }])
    const start = await logger.binlog.lastSeq()
    await store.transaction(async (scope) => {
      await scope.set('a', 'first')
      await scope.putRecord({ value: 'record' }, 'b')
      await scope.set('c', 'third')
      await scope.set('a', 'last')
    })
    const entry = (await logger.binlog.read(start + 1))[0]!.payload as {
      txId: string
      changes: Array<{ target: { channel: 'text' | 'record' | 'vector' }; value: string }>
    }
    expect(entry.changes.map((change) => change.target.channel)).toEqual([
      'text',
      'record',
      'text',
      'text'
    ])
    expect(
      entry.changes
        .filter((change) => change.target.channel === 'text')
        .map((change) =>
          decodePgText(decodePgJournalImage({ present: true, value: change.value }, 'text').value)
        )
    ).toEqual(['first', 'third', 'last'])
    expect((await logger.undo.get(entry.txId))!).toHaveLength(3)
    await store.undo(entry.txId)
    expect(await store.get('a')).toBe('before')
    expect(await store.get('c')).toBeNull()
    expect(await store.getRecord('b')).toBeUndefined()
    const vectorStart = await logger.binlog.lastSeq()
    await points.upsert([{ id: 'v', vector: [1] }])
    await points.upsert([{ id: 'v', vector: [2] }])
    const vectorEntries = await logger.binlog.read(vectorStart + 1)
    expect(
      vectorEntries.map((item) => {
        const value = item.payload as typeof entry
        return decodePgJournalImage({ present: true, value: value.changes[0]!.value }, 'vector')
          .value
      })
    ).toEqual(['[1]', '[2]'])
    const concurrentStart = await logger.binlog.lastSeq()
    await store.transaction((scope) =>
      Promise.all([scope.set('parallel', 'first'), scope.set('parallel', 'last')])
    )
    const concurrent = (await logger.binlog.read(concurrentStart + 1))[0]!.payload as typeof entry
    expect(
      concurrent.changes.map((change) =>
        decodePgText(decodePgJournalImage({ present: true, value: change.value }, 'text').value)
      )
    ).toEqual(['first', 'last'])
  })
  it('captures exact native changes once and appends only after the real original COMMIT', async () => {
    const pool = new Pool({ connectionString })
    const client = postgres(connectionString!, { max: 8 })
    const driver = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
    const logger = new Logger({ ...loggerOptions, plugins: [binlog({ store: memoryLogStore() })] })
    const org = randomUUID()
    const host = await createStorageHost({
      org,
      plugins: [
        postgresBackendPlugin(
          { driver, prefix: 'pg_journal_' + randomUUID().slice(0, 8) },
          { vectors: pgvectorFeature() }
        )
      ] as const,
      journal: { logger, namespace: 'native', binlogValues: true }
    })
    onTestFinished(async () => {
      await host.dispose()
      await logger.shutdown('manual')
      await pool.end()
      await client.end()
    })
    const store = host.backend('postgres')
    await store.transaction(async (scope) => {
      await scope.set('text', 'first')
      await scope.set('text', 'last')
      await scope.setBytes('bytes', new Uint8Array([0, 255]))
      await scope.putRecord(new Map([['kind', new Set([1, 2])]]), ['record', 1])
      expect(await logger.binlog.read(1)).toEqual([])
    })
    const records = await logger.binlog.read(1)
    expect(records).toHaveLength(1)
    const payload = records[0]!.payload
    expect(payload).toMatchObject({ version: 1, changes: expect.any(Array) })
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !('changes' in payload) ||
      !Array.isArray(payload.changes)
    )
      throw new Error('missing original commit payload')
    expect(payload.changes).toHaveLength(4)
    for (const change of payload.changes) {
      if (
        change === null ||
        typeof change !== 'object' ||
        Array.isArray(change) ||
        !('value' in change) ||
        typeof change.value !== 'string' ||
        !('target' in change) ||
        change.target === null ||
        typeof change.target !== 'object' ||
        Array.isArray(change.target) ||
        !('channel' in change.target)
      )
        throw new Error('missing native change image')
      const channel = change.target.channel
      if (channel !== 'text' && channel !== 'bytes' && channel !== 'record')
        throw new Error('unexpected native channel')
      expect(decodePgJournalImage({ present: true, value: change.value }, channel).channel).toBe(
        channel
      )
    }
    await expect(
      store.transaction(async (scope) => {
        await scope.set('rollback', 'draft')
        throw new Error('abort-native')
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(await logger.binlog.read(1)).toHaveLength(1)
    expect(await store.get('rollback')).toBeNull()
    await store.use(kv).setMany([
      { key: ['batch', 1], value: 'one' },
      { key: ['batch', 2], value: 'two' }
    ])
    expect(await store.use(kv).removeByPrefix(['batch'])).toBe(2)
    const points = store.use(vector).collection('points', { dimensions: 2, metric: 'dot' })
    await points.upsert([{ id: 'point', vector: [1, 0], payload: { kind: 'native' } }])
    await store.use(ttl).expire(lockKey.vector('points', 'point'), 10000)
    expect(await points.deleteWhere({ kind: 'native' })).toBe(1)
    await host.org(org).backend('postgres').set('explicit-default', 'same-native-org')
    const other = host.org(randomUUID()).backend('postgres')
    await other.set('other-org', 'isolated')
    expect(await store.get('other-org')).toBeNull()
    const all = await logger.binlog.read(1)
    expect(all).toHaveLength(8)
    await expect(store.sql`SELECT 1`.get()).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY'
    })
  })
})

it('retains a pending WAL intent when lost COMMIT evidence leaves the native outcome unknown', async () => {
  const pool = new Pool({ connectionString })
  const native = pgDriver(pool)
  const prefix = 'pg_wal_unknown_' + randomUUID().slice(0, 8)
  const org = randomUUID()
  const original = new Error('lost COMMIT acknowledgement with external WAL')
  const unavailable = new Error('native commit evidence unavailable')
  let armed = false
  let lost = false
  const driver = {
    ...native,
    query: (...args: Parameters<typeof native.query>) => {
      if (lost && args[0].startsWith('SELECT value FROM ') && args[0].includes('_commit_markers'))
        throw unavailable
      return native.query(...args)
    },
    connect: async (...args: Parameters<typeof native.connect>) => {
      const client = await native.connect(...args)
      return {
        ...client,
        query: async (...args: Parameters<typeof client.query>) => {
          const value = await client.query(...args)
          if (armed && args[0] === 'COMMIT') {
            armed = false
            lost = true
            throw original
          }
          return value
        }
      }
    }
  }
  const logger = new Logger({
    ...loggerOptions,
    plugins: [binlog({ store: memoryLogStore() }), wal({ store: memoryLogStore() })]
  })
  let host = await createStorageHost({
    org,
    plugins: [postgresBackendPlugin({ driver, prefix })] as const,
    journal: { logger, namespace: 'unknown' }
  })
  onTestFinished(async () => {
    await host.dispose()
    await logger.shutdown('manual')
    await pool.end()
  })
  armed = true
  const failure = await host
    .backend('postgres')
    .transaction((scope) => scope.set('key', 'committed'))
    .then(
      () => undefined,
      (cause: unknown) => cause
    )
  expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED' })
  expect(walkErrorCauses(failure)).toContain(original)
  expect(walkErrorCauses(failure)).toContain(unavailable)
  expect((await pool.query('SELECT key FROM ' + prefix + '_kv')).rows).toHaveLength(1)
  expect(await logger.wal.pending()).toHaveLength(1)
  await host.dispose()
  host = await createStorageHost({
    org,
    plugins: [postgresBackendPlugin({ driver: native, prefix })] as const,
    journal: { logger, namespace: 'unknown' }
  })
  expect(await host.backend('postgres').get('key')).toBe('committed')
  expect(await logger.binlog.read(1)).toHaveLength(1)
  expect(await logger.wal.pending()).toEqual([])
})

it('awaits original external append settlement without replacing a committed result', async () => {
  const pool = new Pool({ connectionString })
  const logger = new Logger({ ...loggerOptions, plugins: [binlog({ store: memoryLogStore() })] })
  const entered = deferred<void>(),
    release = deferred<void>()
  const original = new Error('external-append-failure')
  const reports: unknown[] = []
  const borrowed = {
    dispatchRaw: logger.dispatchRaw,
    onFailure: logger.onFailure,
    hook: logger.hook,
    flush: logger.flush,
    defer: logger.defer,
    binlog: {
      ...logger.binlog,
      append: async () => {
        entered.resolve()
        await release.promise
        throw original
      }
    }
  }
  const prefix = 'pg_append_' + randomUUID().slice(0, 8)
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix
      })
    ] as const,
    journal: { logger: borrowed, namespace: 'external' },
    report: (error) => {
      reports.push(error)
    }
  })
  onTestFinished(async () => {
    release.resolve()
    await host.dispose()
    await logger.shutdown('manual')
    await pool.end()
  })
  const store = host.backend('postgres')
  let complete = false
  const pending = store.set('key', 'committed').then(() => {
    complete = true
  })
  await entered.promise
  expect(complete).toBe(false)
  // A direct original driver read does not need the still-pending external journal append.
  expect((await pool.query('SELECT key FROM ' + prefix + '_kv')).rows).toHaveLength(1)
  release.resolve()
  await pending
  expect(reports).toEqual([original])
})

it('rejects cached native log stores before private I/O when no reliable namespace lifetime lock exists', async () => {
  const pool = new Pool({ connectionString })
  const native = pgDriver(pool)
  const statements: string[] = []
  const driver = {
    ...native,
    query: (...args: Parameters<typeof native.query>) => {
      statements.push(args[0])
      return native.query(...args)
    }
  }
  onTestFinished(async () => {
    await pool.end()
  })
  const failure = await createStorageHost({
    plugins: [
      postgresBackendPlugin({ driver, prefix: 'pg_log_owner_' + randomUUID().slice(0, 8) })
    ] as const,
    journal: async ({ storageLogStore }) => {
      await storageLogStore('postgres', { prefix: 'native' })
      throw new Error('unreachable')
    }
  }).then(
    () => undefined,
    (cause: unknown) => cause
  )
  expect(
    walkErrorCauses(failure).some(
      (error) =>
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'UNSUPPORTED_CAPABILITY'
    )
  ).toBe(true)
  expect(statements.some((text) => text.startsWith('SELECT') && text.includes('_journal'))).toBe(
    false
  )
})
