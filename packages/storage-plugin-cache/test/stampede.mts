import { createClientPool } from 'redis'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { cachePlugin } from '@migaia/storage-plugin-cache'

/** Each actual process borrows its own connection pool to the same fresh Redis namespace. */
const prefix = process.argv[2]!,
  pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL }, { maximum: 8 })
await pool.connect()
/** Root lookups are counted outside storage transactions solely to coordinate this finite fixture. */
const reads = prefix + ':reads',
  loads = prefix + ':loads'
const observer = definePlugin('root-lookups', (core) => ({
  install() {
    core.useAsyncPipeline(async (input, next) => {
      if (input.backendId === 'redis' && input.operation === 'get' && input.scope === undefined)
        await pool.sendCommand(['INCR', reads])
      return next(input)
    })
    return {}
  }
}))
const base = await createStorageHost({
  plugins: [redisBackendPlugin({ id: 'redis', driver: nodeRedisDriver(pool), prefix }), observer]
})
const host = await base.use(
  cachePlugin({
    propagate: false,
    tiers: [{ backend: 'redis', ttlMs: 10000 }],
    stampedeLock: { backend: 'redis', timeoutMs: 5000 }
  })
)
await host.detect()
try {
  const value = await host.backend('cache').getOrLoad('same', async () => {
    await pool.sendCommand(['INCR', loads])
    for (let step = 0; step < 500; step++) {
      if (Number(await pool.sendCommand(['GET', reads])) >= 2) return 'shared-native-source'
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return 'lookup-coordination-expired'
  })
  console.log(JSON.stringify({ value }))
} finally {
  await host.dispose()
  await pool.close()
}
