import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import postgres from 'postgres'
import { describe, it, expect, onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { runConformance } from '@migaia/storage-contract/conformance'
import { kv, records, ttl, counter, sql, vector, durableChangeFeed } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '../src/index.js'
import { pgDriver } from '../src/pg.js'
import { postgresJsDriver } from '../src/postgres-js.js'
import { pgvectorFeature } from '../src/features/pgvector.js'
import { pgLogicalReplicationFeature } from '../src/features/logical-replication.js'
import { decodePgRecord } from '../src/codec.js'
/** The real fixture is mandatory; an absent address never becomes a passing skipped backend. */
const connectionString = process.env.MIGAIA_PG_URL
if (!connectionString)
  throw new Error('Run through scripts/storage-services.mts run -- to provide PostgreSQL')
/** The canonical suite creates an original native store and resource set independently per case. */
for (const adapter of ['pg', 'postgres-js'] as const)
  runConformance(
    { describe, it, expect },
    {
      name: 'real PostgreSQL ' + adapter + ' selected canonical',
      capabilities: [
        kv,
        records,
        ttl,
        counter,
        sql,
        vector,
        ...(adapter === 'pg' ? [durableChangeFeed] : [])
      ],
      features: {
        batch: true,
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
        const client = postgres(connectionString!, { max: 8 })
        const org = randomUUID()
        const driver = adapter === 'pg' ? pgDriver(pool) : postgresJsDriver(client)
        const prefix = adapter === 'pg' ? 'pg_contract_selected' : 'pg_js_contract_selected'
        const slot = 'pg_contract_' + randomUUID().replaceAll('-', '')
        const publication = process.env.MIGAIA_PG_PUBLICATION
        if (!publication)
          throw new Error(
            'Run through scripts/storage-services.mts run -- to provide PostgreSQL replication'
          )
        if (adapter === 'pg')
          await pool.query('SELECT pg_create_logical_replication_slot($1,$2)', [slot, 'pgoutput'])
        const host =
          adapter === 'pg'
            ? await createStorageHost({
                org,
                plugins: [
                  postgresBackendPlugin(
                    { driver, prefix },
                    {
                      vector: pgvectorFeature(),
                      replication: pgLogicalReplicationFeature({ slot, publication })
                    }
                  )
                ] as const
              })
            : await createStorageHost({
                org,
                plugins: [
                  postgresBackendPlugin({ driver, prefix }, { vector: pgvectorFeature() })
                ] as const
              })
        onTestFinished(async () => {
          await host.dispose()
          for (const row of (
            await driver.query('SELECT value FROM public.' + prefix + '_vector_config', [])
          ).rows) {
            const configuration = decodePgRecord<{ table: string }>(row.value)
            await driver.query('DELETE FROM ' + configuration.table + ' WHERE org_id=$1', [org])
          }
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
          await client.end()
          if (adapter === 'pg') {
            // The already-disposed host leaves its deployment-owned slot for explicit fixture cleanup.
            const cleanup = new Pool({ connectionString })
            try {
              await cleanup.query('SELECT pg_drop_replication_slot($1)', [slot])
            } finally {
              await cleanup.end()
            }
          }
        })
        return host.backend('postgres')
      }
    }
  )
