import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import postgres from 'postgres'
import { it, expect, onTestFinished, describe } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { Logger } from '@migaia/logger'
import { binlog, memoryLogStore } from '@migaia/logger/plugins/durable'
import { kv, vector, ttl, lockKey } from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { postgresJsDriver } from '../src/postgres-js.js'
import { pgvectorFeature } from '../src/features/pgvector.js'
import { decodePgJournalImage } from '../src/journal.js'
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
    expect(payload.changes).toHaveLength(3)
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
