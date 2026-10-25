import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { it, expect, onTestFinished, vi } from 'vitest'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { kv } from '@migaia/storage-contract'
import { ConcurrencyPolicy, lockKey } from '@migaia/storage-host/authoring/concurrency'
import { walkErrorCauses } from '@migaia/utils/error'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
/** Real service facts own native length and client-lifetime admission. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')

it('rejects invalid identifiers before DDL and retains native quoted identifier boundaries', async () => {
  const pool = new Pool({ connectionString })
  onTestFinished(async () => {
    await pool.end()
  })
  const native = pgDriver(pool)
  const statements: string[] = []
  const driver = {
    ...native,
    query: (...args: Parameters<typeof native.query>) => {
      statements.push(args[0])
      return native.query(...args)
    }
  }
  const limit = Number(
    (await native.query('SHOW max_identifier_length', [])).rows[0]?.max_identifier_length
  )
  for (const options of [
    { prefix: 'bad\0prefix' },
    { prefix: 'bad\ud800prefix' },
    { prefix: 'x'.repeat(limit) },
    { schema: 'x'.repeat(limit + 1) }
  ]) {
    statements.length = 0
    const failure = await createStorageHost({
      plugins: [postgresBackendPlugin({ driver, ...options })] as const
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
          error.code === 'INVALID_ARGUMENT'
      )
    ).toBe(true)
    expect(statements.some((text) => text.startsWith('CREATE'))).toBe(false)
  }
  for (const prefix of [
    'pg"quoted_' + randomUUID().slice(0, 8),
    'x'.repeat(limit - '_commit_markers'.length)
  ]) {
    const host = await createStorageHost({
      org: randomUUID(),
      plugins: [postgresBackendPlugin({ driver, prefix })] as const
    })
    try {
      await host.backend('postgres').set('native', 'quoted')
      expect(await host.backend('postgres').get('native')).toBe('quoted')
    } finally {
      await host.dispose()
    }
  }
})

it('keeps original before hooks report-only and one pipeline per actual operation', async () => {
  const pool = new Pool({ connectionString })
  const reports: unknown[] = [],
    operations: string[] = [],
    seen = new Set<string>()
  const original = new Error('observed-before-hook')
  const counting = definePlugin('pg-host-counting', (core) => ({
    install() {
      core.useAsyncPipeline((request, next) => {
        operations.push(request.operation)
        return next(request)
      })
      return {}
    }
  }))
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix: 'pg_hooks_' + randomUUID().slice(0, 8)
      }),
      counting
    ] as const,
    report: (error) => {
      reports.push(error)
    }
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.end()
  })
  for (const hook of [
    'beforeTransaction',
    'beforeTxOperation',
    'beforeStorageOperation',
    'beforeEncode',
    'beforeDecode',
    'beforeSql',
    'beforeCommit',
    'beforeLockAcquire'
  ] as const) {
    host.hooks.on(hook, () => {
      seen.add(hook)
      throw original
    })
    host.hooks.on(hook, () => Promise.reject(original))
  }
  const store = host.backend('postgres')
  operations.length = 0
  await store.set('key', 'value')
  expect(operations).toEqual(['set'])
  operations.length = 0
  expect(await store.get('key')).toBe('value')
  expect(operations).toEqual(['get'])
  await store.transaction(
    async (scope) => {
      await scope.set('scoped', 'accepted')
      expect(await scope.get('scoped')).toBe('accepted')
    },
    { lock: [lockKey.text('scoped')], concurrency: ConcurrencyPolicy.wait() }
  )
  expect((await store.sql`SELECT 1::int4 AS value`.get())?.value).toBe(1)
  await Promise.resolve()
  for (const hook of [
    'beforeTransaction',
    'beforeTxOperation',
    'beforeStorageOperation',
    'beforeEncode',
    'beforeDecode',
    'beforeSql',
    'beforeCommit',
    'beforeLockAcquire'
  ])
    expect(seen.has(hook), hook).toBe(true)
  expect(reports.length).toBeGreaterThanOrEqual(seen.size * 2)
  expect(reports.every((error) => error === original)).toBe(true)
  const primary = store.dispose(),
    symbolic = store[Symbol.asyncDispose]()
  expect(store.dispose()).toBe(primary)
  expect(store[Symbol.asyncDispose]()).toBe(symbolic)
  await primary
  await symbolic
  await expect(store.get('key')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
  expect(pool.totalCount - pool.idleCount).toBe(0)
  expect((await pool.query('SELECT 1::int4 AS value')).rows[0]).toEqual({ value: 1 })
})

it('uses one native array binding for a batch beyond the PostgreSQL parameter limit', async () => {
  const pool = new Pool({ connectionString })
  const host = await createStorageHost({
    org: randomUUID(),
    plugins: [
      postgresBackendPlugin({
        driver: pgDriver(pool),
        prefix: 'pg_large_' + randomUUID().slice(0, 8)
      })
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.end()
  })
  const api = host.backend('postgres').use(kv)
  const entries = Array.from({ length: 65536 }, (_, index) => ({
    key: ['bulk', index],
    value: String(index)
  }))
  await api.setMany(entries)
  expect(await api.getMany([entries[65535]!.key, entries[0]!.key, entries[65535]!.key])).toEqual([
    '65535',
    '0',
    '65535'
  ])
  expect(await api.removeMany(entries.map((entry) => entry.key))).toBe(entries.length)
}, 30000)

/** A real subscription closes before its injected return failure reaches the original controller. */
it('keeps disposal promise identity and the original return failure without closing the caller pool', async () => {
  const pool = new Pool({ connectionString })
  const native = pgDriver(pool)
  const original = new Error('native-return-failure')
  let closes = 0
  const driver = {
    ...native,
    listen: async (...args: Parameters<NonNullable<typeof native.listen>>) => {
      const resource = await native.listen!(...args)
      let main: Promise<void> | undefined
      return {
        ...resource,
        dispose: () =>
          (main ??= (async () => {
            closes += 1
            await resource.dispose()
            throw original
          })())
      }
    }
  }
  const reports: unknown[] = []
  const report = vi.spyOn(console, 'error').mockImplementation((_message, error) => {
    reports.push(error)
  })
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin({ driver, prefix: 'pg_return_' + randomUUID().slice(0, 8) })
    ] as const
  })
  onTestFinished(async () => {
    try {
      const failure = await host.dispose().then(
        () => undefined,
        (cause: unknown) => cause
      )
      expect(walkErrorCauses(failure)).toContain(original)
    } finally {
      report.mockRestore()
      await pool.end()
    }
  })
  const store = host.backend('postgres')
  const primary = store.dispose(),
    symbolic = store[Symbol.asyncDispose]()
  expect(store.dispose()).toBe(primary)
  expect(store[Symbol.asyncDispose]()).toBe(symbolic)
  const failure = await primary.then(
    () => undefined,
    (cause: unknown) => cause
  )
  expect(walkErrorCauses(failure)).toContain(original)
  await expect(symbolic).resolves.toBeUndefined()
  expect(closes).toBe(1)
  expect(reports).toEqual([failure])
  expect(pool.totalCount - pool.idleCount).toBe(0)
  expect((await pool.query('SELECT 1::int4 AS value')).rows[0]).toEqual({ value: 1 })
})
