import { storageJournalPlugin } from '@migaia/storage-host/journal'
import { Pool } from 'pg'
import { createClientPool } from 'redis'
import { expect, it } from 'vitest'
import {
  createStorageHost,
  memoryBackendPlugin,
  definePlugin,
  createOrgId
} from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import {
  runStorageProgramApp,
  runStorageProgramBatch,
  createStorageProgramJournal,
  runStorageProgramOrgs,
  storageProgramBatchObservations
} from '../../storage-plugin-sqlite/test/helpers/program-app.js'

/** All native addresses come from the existing repository service launcher. */
const redisUrl = process.env.MIGAIA_REDIS_URL,
  pgUrl = process.env.MIGAIA_PG_URL
if (!redisUrl || !pgUrl) throw new Error('Run with scripts/storage-services.mts run --')

it.each(['memory', 'sqlite', 'redis', 'postgres'] as const)(
  'runs unchanged entity/persist/locked transaction/binlog and native batch code on %s',
  async (backend) => {
    const pool = createClientPool({ url: redisUrl }, { maximum: 8 }),
      pg = new Pool({ connectionString: pgUrl })
    await pool.connect()
    const connection = nodeSqliteDriver(':memory:')
    const { logs, logger } = createStorageProgramJournal()
    const events: string[] = [],
      pipelines: string[] = []
    const observed = definePlugin('program-observer', (core) => ({
      install() {
        core.useAsyncPipeline((input, next) => {
          pipelines.push(input.operation)
          return next(input)
        })
        return {}
      }
    }))
    const prefix = 'program_' + crypto.randomUUID().replaceAll('-', '')
    const selectPlugin = () =>
      backend === 'memory'
        ? memoryBackendPlugin({ id: 'data' })
        : backend === 'sqlite'
          ? sqliteBackendPlugin({ id: 'data', driver: connection })
          : backend === 'redis'
            ? redisBackendPlugin({ id: 'data', driver: nodeRedisDriver(pool), prefix })
            : postgresBackendPlugin({ id: 'data', driver: pgDriver(pg), prefix })
    const host = await createStorageHost({
      org: createOrgId(),
      plugins: [storageJournalPlugin({ logger, namespace: 'program' }), selectPlugin(), observed],
      hooks: {
        beforeStorageOperation: ({ operation }) => events.push('before:' + operation),
        afterStorageOperation: ({ operation }) => events.push('after:' + operation),
        onStorageOperationError: ({ operation }) => events.push('error:' + operation)
      }
    })
    try {
      const store = host.backend('data')
      expect(await runStorageProgramApp(store)).toEqual({
        rows: [
          { id: 'a', score: 3 },
          { id: 'b', score: 2 }
        ],
        persisted: { version: 1, state: { count: 3 } },
        status: 'committed'
      })
      expect((await logs.read(1, 100)).some((row) => row.kind === 'storage.commit')).toBe(true)
      events.length = 0
      pipelines.length = 0
      expect(await runStorageProgramBatch(store)).toEqual({
        ordered: ['b', 'a', undefined, 'a'],
        removed: 1,
        failed: true,
        unchanged: true,
        record: { id: 'occupied', score: 0 }
      })
      expect(storageProgramBatchObservations(pipelines, events)).toEqual({
        getMany: [1, 1, 1, 0],
        setMany: [2, 2, 1, 1],
        removeMany: [1, 1, 1, 0]
      })
      // Organization deletion is the ordinary unjournaled contract; live global journal reset is isolated.
      await host.dispose()
      const plain = await createStorageHost({ org: createOrgId(), plugins: [selectPlugin()] })
      try {
        const one = createOrgId(),
          two = createOrgId()
        expect(
          await runStorageProgramOrgs(
            plain.backend('data'),
            plain.org(one).backend('data'),
            plain.org(two).backend('data'),
            () => plain.dropOrg(one)
          )
        ).toEqual({ before: ['default', 'one', 'two'], after: ['default', null, 'two'] })
      } finally {
        await plain.dispose()
      }
    } finally {
      await host.dispose()
      await logger.shutdown('manual')
      await connection.dispose()
      await pool.close()
      await pg.end()
    }
  }
)
