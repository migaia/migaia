import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { pgLogicalReplicationFeature } from '@migaia/storage-plugin-postgres/features/logical-replication'
import { cachePlugin } from '../src/index.ts'
import { PgReplicationTestService } from '../../storage-plugin-postgres/test/helpers/replication-service.ts'

/** Cache joins the same scheduler as the PostgreSQL logical-decoding files. */
const replicationService = new PgReplicationTestService()
beforeAll(() => replicationService.acquire(), 120000)
afterAll(() => replicationService.release())

/** A root reset must remove upper-tier copies for every already accessed organization. */
it('invalidates every cache org after the PostgreSQL root feed emits reset', async () => {
  /** The repository launcher supplies a cluster isolated from ordinary PostgreSQL tests. */
  const connectionString = replicationService.connectionString
  const publication = process.env.MIGAIA_PG_PUBLICATION
  if (!connectionString || !publication)
    throw new Error('PostgreSQL replication service is required')
  /** Each test owns its slot and physical store prefix, while the pool remains caller-owned. */
  const pool = new Pool({ connectionString })
  const slot = 'cache_reset_' + randomUUID().replaceAll('-', '')
  const prefix = 'cache_reset_' + randomUUID().slice(0, 8)
  await pool.query('SELECT pg_create_logical_replication_slot($1,$2)', [slot, 'pgoutput'])
  const base = await createStorageHost({
    plugins: [
      memoryBackendPlugin({ id: 'upper' }),
      postgresBackendPlugin(
        { id: 'lower', driver: pgDriver(pool), prefix },
        {
          replication: pgLogicalReplicationFeature({ slot, publication })
        }
      )
    ] as const
  })
  const host = await base.use(
    cachePlugin({ tiers: [{ backend: 'upper', ttlMs: 10000 }, { backend: 'lower' }] })
  )
  try {
    await host.detect()
    const org = host.org(randomUUID())
    await host.backend('cache').set('same', 'root')
    await org.backend('cache').set('same', 'org')
    await vi.waitFor(async () => {
      expect(await host.backend('upper').get('cache:cache:$cache.cursor')).not.toBeNull()
    })
    expect(await host.backend('cache').get('same')).toBe('root')
    expect(await org.backend('cache').get('same')).toBe('org')
    await pool.query('TRUNCATE "public"."' + prefix + '_kv"')
    await vi.waitFor(async () => {
      expect(await host.backend('upper').get('cache:cache:same')).toBeNull()
      expect(await org.backend('upper').get('cache:cache:same')).toBeNull()
    })
    expect(await host.backend('cache').get('same')).toBeNull()
    expect(await org.backend('cache').get('same')).toBeNull()
  } finally {
    await host.dispose()
    await pool.query('SELECT pg_drop_replication_slot($1)', [slot])
    await pool.end()
  }
})
