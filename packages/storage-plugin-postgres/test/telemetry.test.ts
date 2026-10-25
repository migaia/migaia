import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { it, expect, onTestFinished } from 'vitest'
import { Logger, type ILogEntry } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'
import { createStorageHost } from '@migaia/storage-host'
import { storageJournalPlugin } from '@migaia/storage-host/journal'
import { ConcurrencyPolicy, lockKey } from '@migaia/storage-host/authoring/concurrency'
import { deferred } from '@migaia/utils/promise'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'

/** Real level output observes original PostgreSQL work without becoming its execution owner. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
/** The original logger retains all scheduling; this fixture owns only its borrowed observation sink. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

it('observes complete original retry loops once with canonical native keys and fixed organization', async () => {
  const pool = new Pool({ connectionString })
  const entries: ILogEntry[] = []
  const logger = new Logger({ execution, plugins: [level()] })
  logger.useSink((entry) => {
    entries.push(entry)
  })
  const host = await createStorageHost({
    plugins: [
      storageJournalPlugin(),
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix: 'pg_telemetry_' + randomUUID().slice(0, 8)
      })
    ] as const,
    journal: { logger, namespace: 'telemetry', telemetry: true }
  })
  onTestFinished(async () => {
    await host.dispose()
    await logger.shutdown('manual')
    await pool.end()
  })
  const store = host.backend('postgres')
  await store.set('key', 'before')
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    tag: 'storage',
    message: 'set',
    meta: {
      backend: 'postgres',
      operation: 'set',
      outcome: 'success',
      payload: { key: 'key', value: 'before' },
      keys: [lockKey.text('key'), lockKey.bytes('key'), lockKey.record('key')]
    }
  })
  await store.metadata.set('private-version', 1)
  expect(entries).toHaveLength(1)
  entries.length = 0
  const entered = deferred<void>(),
    release = deferred<void>()
  let calls = 0
  const pending = store.transaction(
    async (scope) => {
      calls += 1
      const value = await scope.get('key')
      if (calls === 1) {
        entered.resolve()
        await release.promise
      }
      await scope.set('key', value + ':transaction')
    },
    { concurrency: ConcurrencyPolicy.optimistic({ retries: 1, backoffMs: 0 }) }
  )
  await entered.promise
  await store.set('key', 'concurrent')
  release.resolve()
  await pending
  expect(calls).toBe(2)
  expect(entries.map((entry) => entry.message)).toEqual(['set', 'transaction'])
  expect(entries[1]!.meta).toMatchObject({
    outcome: 'success',
    keys: [lockKey.text('key'), lockKey.bytes('key'), lockKey.record('key')]
  })
  entries.length = 0
  const original = new RangeError('native telemetry transaction original')
  const failure = await store
    .transaction(async (scope) => {
      await scope.get('key')
      throw original
    })
    .then(
      () => undefined,
      (cause: unknown) => cause
    )
  expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED', cause: original })
  expect(entries).toHaveLength(1)
  expect(entries[0]!.args[0]).toBe(failure)
  expect(entries[0]!.meta).toMatchObject({ outcome: 'error', code: 'TRANSACTION_FAILED' })
  entries.length = 0
  const orgId = randomUUID(),
    other = host.org(orgId).backend('postgres')
  await other.set('key', 'org')
  const get = other.get
  expect(await get('key')).toBe('org')
  expect(entries).toHaveLength(2)
  expect(entries.every((entry) => entry.meta!.orgId === orgId)).toBe(true)
  expect(entries[0]!.meta!.keys).toEqual([
    lockKey.text('key'),
    lockKey.bytes('key'),
    lockKey.record('key')
  ])
  entries.length = 0
  const readOnlyOrg = randomUUID()
  expect(await host.org(readOnlyOrg).backend('postgres').get('never-written')).toBeNull()
  expect(entries).toHaveLength(1)
  expect(entries[0]!.meta).toMatchObject({
    orgId: readOnlyOrg,
    operation: 'get',
    outcome: 'success',
    keys: [lockKey.text('never-written')]
  })
})

it('keeps disabled level methods unread and contains a closed logger failure', async () => {
  const pool = new Pool({ connectionString })
  const logger = new Logger({ execution, plugins: [level()] })
  let reads = 0
  const borrowed = {
    dispatchRaw: logger.dispatchRaw,
    onFailure: logger.onFailure,
    hook: logger.hook,
    flush: logger.flush,
    defer: logger.defer,
    get atLevel() {
      reads += 1
      return logger.atLevel
    }
  }
  const disabled = await createStorageHost({
    plugins: [
      storageJournalPlugin(),
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix: 'pg_telemetry_off_' + randomUUID().slice(0, 8)
      })
    ] as const,
    journal: { logger: borrowed, namespace: 'disabled' }
  })
  const reports: unknown[] = []
  const enabled = await createStorageHost({
    plugins: [
      storageJournalPlugin(),
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix: 'pg_telemetry_closed_' + randomUUID().slice(0, 8)
      })
    ] as const,
    journal: { logger, namespace: 'enabled', telemetry: true },
    report: (error) => {
      reports.push(error)
    }
  })
  onTestFinished(async () => {
    await enabled.dispose()
    await disabled.dispose()
    await logger.shutdown('manual')
    await pool.end()
  })
  await disabled.backend('postgres').set('key', 'value')
  expect(reads).toBe(0)
  await logger.shutdown('manual')
  await expect(enabled.backend('postgres').set('key', 'committed')).resolves.toBeUndefined()
  expect(reports).toHaveLength(1)
  expect(await disabled.backend('postgres').get('key')).toBe('value')
})
