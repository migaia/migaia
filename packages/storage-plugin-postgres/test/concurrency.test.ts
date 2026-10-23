import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { it, expect, onTestFinished } from 'vitest'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { ConcurrencyPolicy, lockKey, type IConcurrencyPolicy } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { deferred } from '@migaia/utils/promise'
import type { IPgResult } from '../src/index.js'

/** Native fixtures change only their own transaction isolation, never caller-wide settings. */
async function installed(
  serializable = false,
  observation?: {
    sent?(text: string): void
    committed?(pending: Promise<IPgResult>): Promise<IPgResult>
    beforeWork?(): Promise<void>
  }
) {
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
      let work = false
      return {
        ...client,
        query: async (...query: Parameters<typeof client.query>) => {
          const pending = client.query(...query)
          observation?.sent?.(query[0])
          const result =
            work && query[0] === 'COMMIT' && observation?.committed !== undefined
              ? await observation.committed(pending)
              : await pending
          if (query[0] === 'BEGIN ISOLATION LEVEL READ COMMITTED') {
            work = true
            await observation?.beforeWork?.()
          }
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

/** Actual read/write revision changes enter the original strategy instead of physical recovery. */
for (const retries of [0, 1]) {
  it('classifies real SERIALIZABLE same-key conflicts with retries=' + retries, async () => {
    const { store, counts } = await installed(true)
    await store.set('shared', '0')
    const ready = deferred<void>()
    let readers = 0
    const attempts = [0, 0]
    const work = (index: number) =>
      store.transaction(
        async (scope) => {
          attempts[index]! += 1
          const current = Number(await scope.get('shared'))
          if (attempts[index] === 1) {
            readers += 1
            if (readers === 2) ready.resolve()
            await ready.promise
          }
          await scope.set('shared', String(current + 1))
        },
        { concurrency: ConcurrencyPolicy.optimistic({ retries, backoffMs: 0 }), timeoutMs: 5000 }
      )
    const results = await Promise.allSettled([work(0), work(1)])
    expect(counts.physical).toBe(0)
    expect(counts.conflicts).toBe(1)
    if (retries === 0) {
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { code: 'WRITE_CONFLICT' }
      })
      expect(attempts).toEqual([1, 1])
    } else {
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true)
      expect(attempts.toSorted()).toEqual([1, 2])
      expect(await store.get('shared')).toBe('2')
    }
  })
}

/** Fifty real operations per connection exercise shared revisions without a process coordinator. */
it('commits one hundred optimistic read/increment/write transactions across two connections', async () => {
  const { store } = await installed()
  await store.set('total', '0')
  const worker = async () => {
    for (let index = 0; index < 50; index += 1) {
      await store.transaction(
        async (scope) => {
          const value = Number(await scope.get('total'))
          await scope.set('total', String(value + 1))
        },
        {
          concurrency: ConcurrencyPolicy.optimistic({ retries: 100, backoffMs: 0 }),
          timeoutMs: 5000
        }
      )
    }
  }
  await Promise.all([worker(), worker()])
  expect(await store.get('total')).toBe('100')
})

/** Cancellation waits for the original native query and rollback before returning its connection. */
it('drains an accepted native query and rolls back cancellation before COMMIT', async () => {
  const sent = deferred<void>()
  const cancellation = new AbortController()
  const { store, pool } = await installed(false, {
    sent: (text) => {
      if (text.includes('pg_sleep')) sent.resolve()
    }
  })
  const original = new Error('cancel-before-commit')
  const pending = store.transaction(
    async (scope) => {
      await scope.set('cancelled', 'draft')
      await scope.sql`SELECT pg_sleep(0.02)`.get()
    },
    { signal: cancellation.signal }
  )
  await sent.promise
  cancellation.abort(original)
  await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause: original })
  expect(await store.get('cancelled')).toBeNull()
  expect((await pool.query('SELECT 1::int4 AS alive')).rows[0]).toEqual({ alive: 1 })
})

/** After native COMMIT is sent, cancellation cannot turn a real commit into rollback or replay. */
it('waits for actual COMMIT settlement after cancellation', async () => {
  const sent = deferred<void>()
  const release = deferred<void>()
  const cancellation = new AbortController()
  let attempts = 0
  const { store } = await installed(false, {
    committed: async (pending) => {
      sent.resolve()
      await release.promise
      return pending
    }
  })
  const pending = store.transaction(
    async (scope) => {
      attempts += 1
      await scope.set('committed', 'yes')
      return 'committed'
    },
    { signal: cancellation.signal }
  )
  await sent.promise
  cancellation.abort(new Error('cancel-after-send'))
  release.resolve()
  await expect(pending).resolves.toBe('committed')
  expect(attempts).toBe(1)
  expect(await store.get('committed')).toBe('yes')
})

/**
 * The original lease identity is checked before user work and late release cannot delete a
 * successor.
 */
it('rejects a changed native lock owner before invoking user work', async () => {
  let replace = async () => {}
  const { store, pool, prefix } = await installed(false, { beforeWork: () => replace() })
  replace = async () => {
    await pool.query('UPDATE ' + prefix + '_locks SET owner=$1', ['replacement-owner'])
  }
  let called = false
  await expect(
    store.transaction(
      () => {
        called = true
      },
      { lock: [lockKey.text('protected')], concurrency: ConcurrencyPolicy.wait() }
    )
  ).rejects.toMatchObject({ code: 'LOCK_LOST' })
  expect(called).toBe(false)
  expect((await store.inspectLocks())[0]?.holder.owner).toBe('replacement-owner')
})
