import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { createClientPool } from 'redis'
import { Pool } from 'pg'
import { cachePlugin } from '@migaia/storage-plugin-cache'

const redis = createClientPool({ url: process.env.MIGAIA_REDIS_URL })
const postgres = new Pool({ connectionString: process.env.MIGAIA_PG_URL })
await redis.connect()
const prefix = 'cache_guide_' + crypto.randomUUID().replaceAll('-', '')
const base = await createStorageHost({
  plugins: [
    memoryBackendPlugin({ id: 'l1' }),
    sqliteBackendPlugin({ id: 'l2', driver: nodeSqliteDriver(':memory:') }),
    redisBackendPlugin({ id: 'l3', driver: nodeRedisDriver(redis), prefix }),
    postgresBackendPlugin({ id: 'l4', driver: pgDriver(postgres), prefix })
  ]
})
const host = await base.use(
  cachePlugin({
    propagate: false,
    tiers: [
      { backend: 'l1', ttlMs: 10000 },
      { backend: 'l2', ttlMs: 20000 },
      { backend: 'l3', ttlMs: 30000 },
      { backend: 'l4', ttlMs: 60000 }
    ],
    stampedeLock: { backend: 'l3', timeoutMs: 1000 }
  })
)
await host.detect()
try {
  const answer = await host.backend('cache').getOrLoad('answer', async () => ({ text: 'Hello' }))
  if (answer?.text !== 'Hello') throw new Error('Packed native cache value differs')
  await host.backend('cache').clearAll()
} finally {
  await host.dispose()
  await redis.close()
  await postgres.end()
}
console.log(
  JSON.stringify({ status: 'PASS', groups: ['memory', 'sqlite', 'redis', 'postgres', 'cache'] })
)
