import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import postgres from 'postgres'
import { describe, it, expect, onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { deferred } from '@migaia/utils/promise'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { postgresJsDriver } from '../src/postgres-js.js'
import { pgCopyFeature } from '../src/features/copy.js'
import { pgListenFeature } from '../src/features/listen.js'
import type { IPgCopyTarget, IPgDriver } from '../src/types.js'
/** These cases execute real native protocols against the original mandatory service fixture. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
/** Each Feature fixture retains ownership of both native clients after its host has drained. */
async function installed(adapter: 'pg' | 'postgres-js') {
  const pool = new Pool({ connectionString })
  const client = postgres(connectionString!, { max: 8 })
  /** Calls cross the original adapter; observers never substitute COPY or notification results. */
  const native = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
  /** Structured native COPY targets distinguish streaming from row INSERT fallback. */
  const copies: IPgCopyTarget[] = []
  /** Native channels and actual publication statements prove both notification ports. */
  const subscriptions: string[] = []
  const queries: string[] = []
  const driver: IPgDriver = {
    ...native,
    connect: async (...args) => {
      /** Keep the caller-owned connection's original disposal and execution behavior. */
      const connection = await native.connect(...args)
      return {
        ...connection,
        query: (...queryArgs) => {
          queries.push(queryArgs[0])
          return connection.query(...queryArgs)
        },
        copyFrom: (...copyArgs) => {
          copies.push(copyArgs[0])
          return connection.copyFrom!(...copyArgs)
        }
      }
    },
    listen: (...args) => {
      subscriptions.push(args[0])
      return native.listen!(...args)
    }
  }
  const host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver, prefix: 'pg_feature_' + randomUUID().slice(0, 8) },
        { copy: pgCopyFeature(), listen: pgListenFeature() }
      )
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await pool.end()
    await client.end()
  })
  return { host, store: host.backend('postgres'), copies, subscriptions, queries }
}
describe.each(['pg', 'postgres-js'] as const)('%s real native Features', (adapter) => {
  it('streams COPY into the original connection and rolls back a failed or unawaited source', async () => {
    const { store, copies } = await installed(adapter)
    const table = 'copy_' + randomUUID().replaceAll('-', '')
    await store.sql`CREATE TABLE ${store.sql.id(table)} (id integer,value text)`.run()
    const target = { table: [table], columns: ['id', 'value'] } as const
    let sources = 0
    await store.api.copy.from(target, async function* () {
      sources += 1
      yield new TextEncoder().encode('1,first\n2,second\n')
    })
    expect(sources).toBe(1)
    expect(copies).toEqual([target])
    expect(await store.sql`SELECT * FROM ${store.sql.id(table)} ORDER BY id`.all()).toEqual([
      { id: 1, value: 'first' },
      { id: 2, value: 'second' }
    ])
    const original = new Error('copy-source-original')
    await expect(
      store.transaction(async (scope) => {
        void scope.api.copy.from(target, async function* () {
          yield new TextEncoder().encode('3,draft\n')
          throw original
        })
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(
      await store.sql`SELECT count(*)::int4 AS count FROM ${store.sql.id(table)}`.get()
    ).toEqual({ count: 2 })
    await store.transaction(async (scope) => {
      void scope.api.copy.from(target, async function* () {
        yield new TextEncoder().encode('4,accepted\n')
      })
    })
    expect(
      await store.sql`SELECT count(*)::int4 AS count FROM ${store.sql.id(table)}`.get()
    ).toEqual({ count: 3 })
    expect(copies).toEqual([target, target, target])
  })
  it('uses dedicated subscriptions and delivers only committed notifications in native order', async () => {
    const { store, subscriptions, queries } = await installed(adapter)
    const channel = 'notification_' + randomUUID().replaceAll('-', '')
    const seen: string[] = []
    const barrier = deferred<void>()
    const resource = await store.api.notifications.listen(channel, (payload) => {
      seen.push(payload)
      if (payload === 'barrier') barrier.resolve()
    })
    expect(subscriptions.filter((value) => value === channel)).toHaveLength(1)
    await store.api.notifications.notify(channel, 'first')
    await expect(
      store.transaction(async (scope) => {
        await scope.api.notifications.notify(channel, 'rolled-back')
        throw new Error('rollback-notify')
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    await store.transaction((scope) => scope.api.notifications.notify(channel, 'barrier'))
    await barrier.promise
    expect(seen).toEqual(['first', 'barrier'])
    expect(queries.filter((text) => text === 'SELECT pg_notify($1,$2)')).toHaveLength(3)
    const main = resource.dispose()
    expect(resource.dispose()).toBe(main)
    await main
    expect(await store.sql`SELECT 1::int4 AS alive`.get()).toEqual({ alive: 1 })
  })
})
