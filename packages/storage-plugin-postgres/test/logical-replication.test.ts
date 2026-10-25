import { randomUUID } from 'node:crypto'
import { Pool, type QueryArrayConfig } from 'pg'
import { it, expect, onTestFinished, vi } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import {
  durableChangeFeed,
  STORAGE_CONTRACT_SOURCE,
  StorageContractErrorCode
} from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { pgLogicalReplicationFeature } from '../src/features/logical-replication.js'
import { pgKey, encodePgText } from '../src/codec.js'

/** Public admission accepts every publication form only when the complete feed remains observable. */
for (const mode of ['tables', 'schema', 'all', 'missing-table', 'without-truncate'] as const) {
  it('checks publication coverage through the public feed: ' + mode, async () => {
    /** The repository launcher supplies the real PostgreSQL database for this file. */
    const connectionString = process.env.MIGAIA_PG_URL
    if (!connectionString) throw new Error('PostgreSQL replication service is required')
    /** Each public case owns its deployment resources and leaves no persistent fixture slot. */
    const pool = new Pool({ connectionString })
    /** Native identifiers stay within PostgreSQL's limit and need no caller interpolation. */
    const suffix = randomUUID().replaceAll('-', '')
    /** Every case has a separate physical store and publication. */
    const prefix = 'pg_pub_' + suffix.slice(0, 8)
    /** Slot and publication are unique within the test database and cluster. */
    const slot = 'pg_pub_' + suffix
    /** A separate name makes publication ownership visible in native catalog assertions. */
    const publication = 'pg_pub_' + suffix
    /** Installation prepares the tables; explicit detection follows deployment resource creation. */
    const host = await createStorageHost({
      autoDetect: false,
      plugins: [
        postgresBackendPlugin(
          { driver: pgDriver(pool), prefix },
          { replication: pgLogicalReplicationFeature({ slot, publication }) }
        )
      ] as const
    })
    onTestFinished(async () => {
      await host.dispose()
      await pool.query(
        'SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name=$1',
        [slot]
      )
      await pool.query('DROP PUBLICATION IF EXISTS ' + publication)
      await pool.end()
    })
    /** Only the three always-present business channels belong to the explicit-table publication. */
    const tables = ['kv', 'bytes', ...(mode === 'missing-table' ? [] : ['records'])]
    await pool.query(
      'CREATE PUBLICATION ' +
        publication +
        (mode === 'all'
          ? ' FOR ALL TABLES'
          : mode === 'schema'
            ? ' FOR TABLES IN SCHEMA public'
            : ' FOR TABLE ' + tables.map((table) => 'public.' + prefix + '_' + table).join(',')) +
        (mode === 'without-truncate' ? " WITH (publish='insert,update,delete')" : '')
    )
    await pool.query('SELECT pg_create_logical_replication_slot($1,$2)', [slot, 'pgoutput'])
    if (mode === 'missing-table' || mode === 'without-truncate') {
      await expect(host.detect()).rejects.toMatchObject({
        source: STORAGE_CONTRACT_SOURCE,
        code: StorageContractErrorCode.unsupported,
        message:
          mode === 'missing-table'
            ? `PostgreSQL publication "${publication}" is missing table "public"."${prefix}_records"`
            : `PostgreSQL publication "${publication}" does not publish truncate`
      })
      return
    }
    await host.detect()
    if (mode === 'tables')
      expect(
        (
          await pool.query(
            'SELECT tablename FROM pg_publication_tables WHERE pubname=$1 ORDER BY tablename',
            [publication]
          )
        ).rows.map((row) => row.tablename)
      ).toEqual(['bytes', 'kv', 'records'].map((table) => prefix + '_' + table))
    /** The supported public path must deliver a committed write after successful admission. */
    const store = host.backend('postgres')
    /** Save initial progress before writing so the returned invalidation proves native delivery. */
    const feed = store.use(durableChangeFeed)
    /** The first read binds a real cursor to the selected slot and store. */
    const initial = await feed.readChanges()
    await store.set('publication:change', mode)
    /** A real WAL read must produce the new committed invalidation for every accepted form. */
    const changed = await feed.readChanges({ after: initial.cursor })
    expect(changed.changes).toHaveLength(1)
    expect(changed.changes[0]).toMatchObject({ channel: 'all' })
    expect(await store.get('publication:change')).toBe(mode)
  })
}

/** TRUNCATE invalidates all organizations and confirms only after the consumer finishes. */
it('resets root and routed consumers on TRUNCATE and exposes read-only WAL health', async () => {
  const connectionString = process.env.MIGAIA_PG_URL
  const publication = process.env.MIGAIA_PG_PUBLICATION
  if (!connectionString || !publication)
    throw new Error('PostgreSQL replication service is required')
  const pool = new Pool({ connectionString })
  const slot = 'pg_reset_' + randomUUID().replaceAll('-', '')
  const prefix = 'pg_reset_' + randomUUID().slice(0, 8)
  /** Deployment warnings use the backend's existing non-fatal diagnostic reporter. */
  const reports = vi.spyOn(console, 'error').mockImplementation(() => {})
  await pool.query('SELECT pg_create_logical_replication_slot($1,$2)', [slot, 'pgoutput'])
  /** The selected pgoutput port stays real while its public polling and tail admission are observed. */
  const driver = pgDriver(pool)
  const read = vi.spyOn(driver.logicalReplication!, 'read')
  const open = vi.spyOn(driver.logicalReplication!, 'open')
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver, prefix },
        {
          replication: pgLogicalReplicationFeature({ slot, publication })
        }
      )
    ] as const
  })
  onTestFinished(async () => {
    reports.mockRestore()
    await host.dispose()
    await pool.query('SELECT pg_drop_replication_slot($1)', [slot])
    await pool.end()
  })
  const store = host.backend('postgres')
  const feed = store.use(durableChangeFeed)
  const initial = await feed.readChanges()
  expect(read.mock.calls[0]![0]).toMatchObject({ slot, publication, prefix, schema: 'public' })
  await store.transaction(async (scope) => {
    await scope.set('before-truncate', 'discarded')
    await scope.sql`TRUNCATE ${scope.sql.id('public', prefix + '_kv')}, ${scope.sql.id('public', prefix + '_records')}`.run()
  })
  const batch = await feed.readChanges({ after: initial.cursor })
  expect(batch.changes).toHaveLength(1)
  expect(batch.changes[0]).toMatchObject({ kind: 'reset', channel: 'all' })
  expect(batch.changes[0]).not.toHaveProperty('orgId')
  const pending = await pool.query(
    'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
    [slot]
  )
  await feed.readChanges({ after: batch.cursor })
  const confirmed = await pool.query(
    'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
    [slot]
  )
  expect(confirmed.rows[0].lsn).not.toBe(pending.rows[0].lsn)

  const orgId = randomUUID()
  const routed = host.org(orgId).backend('postgres').use(durableChangeFeed)
  await store.sql`TRUNCATE ${store.sql.id('public', prefix + '_kv')}`.run()
  const routedReset = await routed.readChanges()
  expect(routedReset.changes).toHaveLength(1)
  expect(routedReset.changes[0]).toMatchObject({ kind: 'reset', orgId })
  await routed.readChanges({ after: routedReset.cursor })

  const received = deferred<string>()
  const finish = deferred<void>()
  const tail = await feed.tailChanges({
    from: 'now',
    onChange: async (change) => {
      expect(change.kind).toBe('reset')
      expect(change).not.toHaveProperty('orgId')
      received.resolve(
        (
          await pool.query(
            'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
            [slot]
          )
        ).rows[0].lsn
      )
      await finish.promise
    }
  })
  expect(open.mock.calls[0]![0]).toMatchObject({ slot, publication, prefix, from: 'now' })
  await store.sql`TRUNCATE ${store.sql.id('public', prefix + '_kv')}`.run()
  const before = await received.promise
  expect(
    (
      await pool.query(
        'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
        [slot]
      )
    ).rows[0].lsn
  ).toBe(before)
  finish.resolve()
  await vi.waitFor(async () => {
    expect(
      (
        await pool.query(
          'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
          [slot]
        )
      ).rows[0].lsn
    ).not.toBe(before)
  })
  await tail.dispose()
  const facts = await pgDriver(pool).logicalReplication!.detect({
    slot,
    publication,
    prefix,
    schema: 'public'
  })
  expect(facts.confirmedFlushLagBytes).toMatch(/^\d+$/)
  expect(facts.retainedWalBytes).toMatch(/^\d+$/)
  expect(BigInt(facts.retainedWalBytes)).toBeGreaterThanOrEqual(
    BigInt(facts.confirmedFlushLagBytes)
  )
  if (facts.maxSlotWalKeepSize === '-1')
    expect(reports.mock.calls.flat()).toContain(
      'PostgreSQL replication slot has unlimited WAL retention (max_slot_wal_keep_size=-1)'
    )
})

/** Explicit block policy keeps both polling and live commits available for manual intervention. */
it('blocks TRUNCATE without acknowledging when the selected policy is block', async () => {
  const connectionString = process.env.MIGAIA_PG_URL
  const publication = process.env.MIGAIA_PG_PUBLICATION
  if (!connectionString || !publication)
    throw new Error('PostgreSQL replication service is required')
  const pool = new Pool({ connectionString })
  const slot = 'pg_block_' + randomUUID().replaceAll('-', '')
  const prefix = 'pg_block_' + randomUUID().slice(0, 8)
  await pool.query('SELECT pg_create_logical_replication_slot($1,$2)', [slot, 'pgoutput'])
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver: pgDriver(pool), prefix },
        {
          replication: pgLogicalReplicationFeature({ slot, publication, truncate: 'block' })
        }
      )
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.query('SELECT pg_drop_replication_slot($1)', [slot])
    await pool.end()
  })
  const store = host.backend('postgres')
  const feed = store.use(durableChangeFeed)
  const failure = deferred<unknown>()
  const tail = await feed.tailChanges({
    from: 'now',
    onChange: () => {
      throw new Error('Blocked TRUNCATE must not reach its consumer')
    },
    onError: (error) => failure.resolve(error)
  })
  await store.sql`TRUNCATE ${store.sql.id('public', prefix + '_kv')}`.run()
  expect(await failure.promise).toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
  await tail.dispose()
  const before = (
    await pool.query(
      'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
      [slot]
    )
  ).rows[0].lsn
  await expect(feed.readChanges()).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
  expect(
    (
      await pool.query(
        'SELECT confirmed_flush_lsn::text AS lsn FROM pg_replication_slots WHERE slot_name=$1',
        [slot]
      )
    ).rows[0].lsn
  ).toBe(before)
})

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
for (const mode of ['pid-query', 'abort', 'ready-query-abort'] as const) {
  it('drains and rejects actual replication startup ' + mode, async () => {
    const connectionString = process.env.MIGAIA_PG_URL
    const publication = process.env.MIGAIA_PG_PUBLICATION
    if (!connectionString || !publication)
      throw new Error(
        'Run through scripts/storage-services.mts run -- to provide PostgreSQL replication'
      )
    const pool = new Pool({ connectionString })
    const slot = 'pg_startup_' + randomUUID().replaceAll('-', '')
    await pool.query('SELECT pg_create_logical_replication_slot($1,$2)', [slot, 'pgoutput'])
    /** A real storage layout keeps startup failure checks beyond publication admission. */
    const prefix = 'pg_startup_' + randomUUID().slice(0, 8)
    /** This host owns the layout only; the directly opened transport remains under test. */
    const host = await createStorageHost({
      plugins: [postgresBackendPlugin({ driver: pgDriver(pool), prefix })] as const
    })
    const original = new Error('replication-startup-original')
    const cancellation = new AbortController()
    let reported: unknown
    let startupSettled = false
    /** Intercept only the pool readiness query; original native clients keep their real receiver. */
    const observedPool = new Proxy(pool, {
      get(target, key, receiver) {
        if (key !== 'query') return Reflect.get(target, key, receiver)
        return async (input: QueryArrayConfig) => {
          const text = input.text
          if (
            mode === 'pid-query' &&
            typeof text === 'string' &&
            text.includes('SELECT active_pid')
          )
            throw original
          const waiting =
            mode === 'ready-query-abort' &&
            typeof text === 'string' &&
            text.includes('SELECT active_pid')
          const prepared = waiting
            ? {
                ...input,
                text: text.replace(
                  'FROM pg_replication_slots',
                  'FROM pg_replication_slots CROSS JOIN pg_sleep(0.075)'
                )
              }
            : input
          const pending = target.query(prepared)
          if (waiting) cancellation.abort(original)
          const result = await pending
          if (waiting) startupSettled = true
          if (mode === 'abort' && typeof text === 'string' && text.includes('FROM pg_database'))
            cancellation.abort(original)
          return result
        }
      }
    })
    const port = pgDriver(observedPool).logicalReplication!
    try {
      await expect(
        port.open(
          {
            slot,
            publication,
            schema: 'public',
            prefix,
            from: 'now',
            onChange: async () => {},
            onError: (cause) => {
              reported = cause
            }
          },
          { signal: cancellation.signal }
        )
      ).rejects.toMatchObject({
        code: mode === 'pid-query' ? 'SQL_FAILED' : 'ABORTED',
        cause: original
      })
      expect(reported).toMatchObject({
        code: mode === 'pid-query' ? 'SQL_FAILED' : 'ABORTED',
        cause: original
      })
      if (mode === 'ready-query-abort') expect(startupSettled).toBe(true)
      expect((await pool.query('SELECT 1::int4 AS alive')).rows[0]).toEqual({ alive: 1 })
    } finally {
      await host.dispose()
      await pool.query('SELECT pg_drop_replication_slot($1)', [slot])
      await pool.end()
    }
  })
}
