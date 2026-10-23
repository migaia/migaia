import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { it, expect, onTestFinished } from 'vitest'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { ConcurrencyPolicy, lockKey, type IConcurrencyPolicy } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { deferred } from '@migaia/utils/promise'

/** Native fixtures change only their own transaction isolation, never caller-wide settings. */
async function installed(serializable = false) {
  const connectionString = process.env.MIGAIA_PG_URL
  if (!connectionString)
    throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
  const pool = new Pool({ connectionString })
  const native = pgDriver(pool)
  const prefix = 'pg_concurrency_' + randomUUID().slice(0, 8)
  const counts = { transaction: 0, conflicts: 0, physical: 0 }
  const inspect = definePlugin('pg-attempt-observer', (core) => ({
    install() {
      core.useAsyncPipeline((request, next) => {
        if (request.operation === 'transaction') counts.transaction += 1
        return next(request)
      })
      return {}
    }
  }))
  const driver = {
    ...native,
    connect: async (...args: Parameters<typeof native.connect>) => {
      const client = await native.connect(...args)
      return {
        ...client,
        query: async (...query: Parameters<typeof client.query>) => {
          const result = await client.query(...query)
          if (serializable && query[0] === 'BEGIN ISOLATION LEVEL READ COMMITTED')
            await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE', [])
          return result
        }
      }
    }
  }
  const host = await createStorageHost({
    hooks: {
      onLockConflict: () => {
        counts.conflicts += 1
      },
      onRetry: (payload) => {
        if (payload.reason === 'physical') counts.physical += 1
      }
    },
    plugins: [postgresBackendPlugin({ driver, prefix }), inspect] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.end()
  })
  return { store: host.backend('postgres'), pool, prefix, counts }
}

/** Each preset sees real PostgreSQL 40001/40P01 and keeps its strategy outside physical recovery. */
for (const policy of [
  ConcurrencyPolicy.wait(),
  ConcurrencyPolicy.fail(),
  ConcurrencyPolicy.optimistic({ retries: 0 })
] satisfies readonly IConcurrencyPolicy[]) {
  for (const state of ['40001', '40P01'] as const) {
    it(
      'physically replays actual ' +
        state +
        ' under ' +
        policy.name +
        ' without a second pipeline or strategy conflict',
      async () => {
        const { store, pool, prefix, counts } = await installed(state === '40001')
        const table = prefix + '_application'
        await pool.query(
          'CREATE TABLE ' + table + ' (id integer PRIMARY KEY,value integer NOT NULL)'
        )
        await pool.query('INSERT INTO ' + table + ' VALUES(1,0),(2,0)')
        let attempts = 0
        const tokens: unknown[] = []
        await store.transaction(
          async (scope) => {
            attempts += 1
            tokens.push(
              (await pool.query('SELECT attempt_token FROM ' + prefix + '_locks')).rows[0]
                ?.attempt_token
            )
            await scope.get('tracked')
            if (state === '40001') {
              await scope.sql`SELECT * FROM ${scope.sql.id(table)} ORDER BY id`.all()
              if (attempts === 1) {
                const other = await pool.connect()
                try {
                  await other.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
                  await other.query('SELECT * FROM ' + table + ' ORDER BY id')
                  await other.query('UPDATE ' + table + ' SET value=value+1 WHERE id=1')
                  await other.query('COMMIT')
                } finally {
                  other.release()
                }
              }
              await scope.sql`UPDATE ${scope.sql.id(table)} SET value=value+1 WHERE id=2`.run()
            } else if (attempts === 1) {
              await scope.sql`SET LOCAL deadlock_timeout='10ms'`.run()
              await scope.sql`SELECT * FROM ${scope.sql.id(table)} WHERE id=1 FOR UPDATE`.all()
              const other = await pool.connect()
              await other.query('BEGIN')
              await other.query('SELECT * FROM ' + table + ' WHERE id=2 FOR UPDATE')
              const pending = other
                .query('UPDATE ' + table + ' SET value=value+1 WHERE id=1')
                .then(() => other.query('COMMIT'))
                .finally(() => other.release())
              try {
                await scope.sql`UPDATE ${scope.sql.id(table)} SET value=value+1 WHERE id=2`.run()
              } finally {
                await pending
              }
            }
            await scope.set('tracked', 'accepted')
          },
          { lock: [lockKey.text('tracked')], concurrency: policy, timeoutMs: 5000 }
        )
        expect(attempts).toBe(2)
        expect(counts).toEqual({ transaction: 1, conflicts: 0, physical: 1 })
        if (policy.locking === 'pessimistic') expect(tokens[0]).toBe(tokens[1])
        expect(await store.get('tracked')).toBe('accepted')
      }
    )
  }
}

/** Different keys run concurrently; default roots retain wait admission and fail remains immediate. */
it('isolates actual key leases and keeps concurrent root writes reliable', async () => {
  const { store } = await installed()
  const entered = deferred<void>()
  const release = deferred<void>()
  const held = store.transaction(
    async (scope) => {
      entered.resolve()
      await release.promise
      await scope.set('held', 'owner')
    },
    {
      lock: [lockKey.text('held')],
      concurrency: ConcurrencyPolicy.wait(),
      timeoutMs: 5000
    }
  )
  await entered.promise
  let waiting: Promise<void> | undefined
  try {
    await store.set('other', 'parallel')
    await expect(
      store.set('held', 'rejected', { concurrency: ConcurrencyPolicy.fail() })
    ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
    waiting = store.set('held', 'waited')
  } finally {
    release.resolve()
  }
  await held
  await waiting
  await Promise.all(Array.from({ length: 4 }, (_, index) => store.set('same', String(index))))
  expect(await store.get('held')).toBe('waited')
})
