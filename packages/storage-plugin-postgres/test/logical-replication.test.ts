import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { it, expect, onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { durableChangeFeed } from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { pgLogicalReplicationFeature } from '../src/features/logical-replication.js'
import { pgKey, encodePgText } from '../src/codec.js'
import { createPgReplication } from '../src/pg-replication.js'

/** Deployment owns a unique fixture slot; the Feature never creates it or removes it on disposal. */
it('replays partial multi-org commits and confirms only complete caller-processed positions', async () => {
  const connectionString = process.env.MIGAIA_PG_URL
  const publication = process.env.MIGAIA_PG_PUBLICATION
  if (!connectionString || !publication)
    throw new Error(
      'Run through scripts/storage-services.mts run -- to provide PostgreSQL replication'
    )
  const pool = new Pool({ connectionString })
  const slot = 'pg_case_' + randomUUID().replaceAll('-', '')
  const prefix = 'pg_wal_' + randomUUID().slice(0, 8)
  await pool.query('SELECT pg_create_logical_replication_slot($1,$2)', [slot, 'pgoutput'])
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver: pgDriver(pool), prefix },
        {
          replication: pgLogicalReplicationFeature({ slot, publication })
        }
      )
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    // The explicit API owns this fixture slot; disposal must have left it intact and inactive.
    const existing = await pool.query(
      'SELECT active FROM pg_replication_slots WHERE slot_name=$1',
      [slot]
    )
    expect(existing.rows[0]?.active).toBe(false)
    await pool.query('SELECT pg_drop_replication_slot($1)', [slot])
    await pool.end()
  })
  const base = host.backend('postgres')
  const orgId = randomUUID()
  const organization = host.org(orgId).backend('postgres')
  expect(organization.has(durableChangeFeed)).toBe(true)
  const feed = base.use(durableChangeFeed)
  const initial = await feed.readChanges()
  expect(initial.cursor.length).toBeGreaterThan(0)
  const before = (
    await pool.query(
      'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
      [slot]
    )
  ).rows[0].lsn
  await base.transaction(async (scope) => {
    await scope.set('same', 'base')
    await scope.sql`INSERT INTO ${scope.sql.id('public', prefix + '_kv')} (org_id,key,value) VALUES(${orgId},${pgKey('same').hex},${encodePgText('org')})`.run()
  })
  const first = await feed.readChanges({ limit: 1 })
  expect(first.changes).toHaveLength(1)
  expect(first.changes[0]?.orgId).not.toBe(orgId)
  expect(first.changes[0]?.channel).toBe('all')
  expect(
    (
      await pool.query(
        'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
        [slot]
      )
    ).rows[0].lsn
  ).toBe(before)
  const replay = await feed.readChanges({ after: first.cursor, limit: 1 })
  expect(replay.changes.map((change) => change.orgId)).toEqual([orgId])
  expect(
    (
      await pool.query(
        'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
        [slot]
      )
    ).rows[0].lsn
  ).toBe(before)
  const empty = await feed.readChanges({ after: replay.cursor })
  expect(empty).toEqual({ changes: [], cursor: replay.cursor })
  expect(
    (
      await pool.query(
        'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
        [slot]
      )
    ).rows[0].lsn
  ).not.toBe(before)
  await expect(
    organization.use(durableChangeFeed).readChanges({ after: replay.cursor })
  ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

  const failure = new Error('native-logical-callback-original')
  const rejected = deferred<unknown>()
  let failedCursor = ''
  let partialCursor = ''
  const tail = await feed.tailChanges({
    from: replay.cursor,
    onChange: (change) => {
      if (change.orgId !== orgId) {
        partialCursor = change.cursor
        return
      }
      failedCursor = change.cursor
      throw failure
    },
    onError: (cause) => rejected.resolve(cause)
  })
  await base.transaction(async (scope) => {
    await scope.set('later', 'first-attempt')
    await scope.sql`INSERT INTO ${scope.sql.id('public', prefix + '_kv')} (org_id,key,value) VALUES(${orgId},${pgKey('later').hex},${encodePgText('second-org')})`.run()
  })
  expect(await rejected.promise).toMatchObject({ code: 'SQL_FAILED', cause: failure })
  await tail.dispose()
  const accepted = deferred<string>()
  const restarted = await feed.tailChanges({
    from: partialCursor,
    onChange: (change) => {
      accepted.resolve(change.cursor)
    }
  })
  expect(await accepted.promise).toBe(failedCursor)
  const main = restarted.dispose()
  expect(restarted.dispose()).toBe(main)
  await main
  expect(await base.get('later')).toBe('first-attempt')
  await expect(feed.readChanges({ after: initial.cursor })).rejects.toMatchObject({
    code: 'CHANGE_CURSOR_EXPIRED'
  })
})

/** A real replication transport must reject startup failures instead of leaving open pending. */
for (const mode of ['pid-query', 'abort'] as const) {
  it('drains and rejects actual replication startup ' + mode, async () => {
    const connectionString = process.env.MIGAIA_PG_URL
    const publication = process.env.MIGAIA_PG_PUBLICATION
    if (!connectionString || !publication)
      throw new Error(
        'Run through scripts/storage-services.mts run -- to provide PostgreSQL replication'
      )
    const pool = new Pool({ connectionString })
    const native = pgDriver(pool)
    const slot = 'pg_startup_' + randomUUID().replaceAll('-', '')
    await pool.query('SELECT pg_create_logical_replication_slot($1,$2)', [slot, 'pgoutput'])
    const original = new Error('replication-startup-original')
    const cancellation = new AbortController()
    let reported: unknown
    const port = createPgReplication(pool, async (_client, text, params) => {
      if (mode === 'pid-query' && text.includes('SELECT active_pid')) throw original
      const result = await native.query(text, params)
      if (mode === 'abort' && text.includes('FROM pg_database')) cancellation.abort(original)
      return result
    })
    try {
      await expect(
        port.open(
          {
            slot,
            publication,
            schema: 'public',
            prefix: 'never_written',
            from: 'now',
            onChange: async () => {},
            onError: (cause) => {
              reported = cause
            }
          },
          { signal: cancellation.signal }
        )
      ).rejects.toMatchObject({
        code: mode === 'abort' ? 'ABORTED' : 'SQL_FAILED',
        cause: original
      })
      expect(reported).toMatchObject({
        code: mode === 'abort' ? 'ABORTED' : 'SQL_FAILED',
        cause: original
      })
      expect((await pool.query('SELECT 1::int4 AS alive')).rows[0]).toEqual({ alive: 1 })
    } finally {
      await pool.query('SELECT pg_drop_replication_slot($1)', [slot])
      await pool.end()
    }
  })
}
