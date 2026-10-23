import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, it, expect, onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { runConformance } from '@migaia/storage-contract/conformance'
import { kv, records, ttl, counter, sql } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
/** The real fixture is mandatory; an absent address never becomes a passing skipped backend. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
/** The canonical suite creates an original native store and resource set independently per case. */
runConformance(
  { describe, it, expect },
  {
    name: 'real PostgreSQL canonical',
    capabilities: [kv, records, ttl, counter, sql],
    features: {
      syncRead: false,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: true,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    create: async () => {
      const pool = new Pool({ connectionString })
      const org = randomUUID()
      const driver = pgDriver(pool)
      const prefix = 'pg_contract'
      const host = await createStorageHost({
        org,
        plugins: [postgresBackendPlugin({ driver, prefix })] as const
      })
      onTestFinished(async () => {
        await host.dispose()
        for (const suffix of [
          'kv',
          'bytes',
          'records',
          'meta',
          'revisions',
          'locks',
          'journal',
          'commit_markers',
          'vector_config'
        ])
          await driver.query('DELETE FROM public.' + prefix + '_' + suffix + ' WHERE org_id=$1', [
            org
          ])
        await pool.end()
      })
      return host.backend('postgres')
    }
  }
)
