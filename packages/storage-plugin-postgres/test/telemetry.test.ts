import { StorageLogObserver } from '../../storage-host/test/helpers/log-observer.ts'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { it, expect, onTestFinished } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { levelPlugin } from '@migaia/log-host'
import { createStorageHost } from '@migaia/storage-host'
import { storageJournalPlugin } from '@migaia/storage-host/plugins/journal'
import { ConcurrencyPolicy, lockKey } from '@migaia/storage-host/sdk'
import { deferred } from '@migaia/utils/promise'
import { postgresBackendPlugin } from '../src/index.ts'
import { pgDriver } from '../src/pg.ts'

/** Real level output observes original PostgreSQL work without becoming its execution owner. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
/** The original logger retains all scheduling; this fixture owns only its borrowed observation sink. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

it('observes complete original retry loops once with canonical native keys and fixed organization', async () => {
  const pool = new Pool({ connectionString })
  /** A real installed plugin observes the asynchronous log host's original entries. */
  const observer = new StorageLogObserver()
  /** Keep the existing assertions over the observer's exact entry array. */
  const entries = observer.entries
  const logger = createLogHost({ execution, plugins: [levelPlugin(), observer] })
  const host = await createStorageHost({
    plugins: [
      storageJournalPlugin({ logger, namespace: 'telemetry', telemetry: true }),
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix: 'pg_telemetry_' + randomUUID().slice(0, 8)
      })
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await logger.shutdown('manual')
    await pool.end()
  })
  const store = host.backend('postgres')
  await store.set('key', 'before')
  await logger.flush()
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
  await logger.flush()
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
  await logger.flush()
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
  await logger.flush()
  expect(entries).toHaveLength(1)
  expect(entries[0]!.args[0]).toBe(failure)
  expect(entries[0]!.meta).toMatchObject({ outcome: 'error', code: 'TRANSACTION_FAILED' })
  entries.length = 0
  const orgId = randomUUID(),
    other = host.org(orgId).backend('postgres')
  await other.set('key', 'org')
  const get = other.get
  expect(await get('key')).toBe('org')
  await logger.flush()
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
  await logger.flush()
  expect(entries).toHaveLength(1)
  expect(entries[0]!.meta).toMatchObject({
    orgId: readOnlyOrg,
    operation: 'get',
    outcome: 'success',
    keys: [lockKey.text('never-written')]
  })
})

it('keeps disabled level methods unread and contains a borrowed level capability failure', async () => {
  const pool = new Pool({ connectionString })
  const logger = createLogHost({ execution, plugins: [levelPlugin()] })
  let reads = 0
  const borrowed = {
    get atLevel() {
      reads += 1
      return logger.atLevel
    }
  }
  const disabled = await createStorageHost({
    plugins: [
      storageJournalPlugin({ logger: borrowed, namespace: 'disabled' }),
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix: 'pg_telemetry_off_' + randomUUID().slice(0, 8)
      })
    ] as const
  })
  /** A borrowed capability can throw even though the authentic host contains dispatch failures. */
  const original = new RangeError('borrowed native telemetry capability failed')
  /** Retain the real level methods while preserving storage's original catch/report boundary. */
  const failing = {
    ...logger,
    atLevel() {
      throw original
    }
  }
  const reports: unknown[] = []
  const enabled = await createStorageHost({
    plugins: [
      storageJournalPlugin({ logger: failing, namespace: 'enabled', telemetry: true }),
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix: 'pg_telemetry_closed_' + randomUUID().slice(0, 8)
      })
    ] as const,
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
  expect(reports[0]).toBe(original)
  expect(await disabled.backend('postgres').get('key')).toBe('value')
})
