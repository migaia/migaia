import type { ICaseDoc, IText } from './contract.js'
/** Bilingual examples preserve the genuine client's independent ownership. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Only delivered native driver entries appear in this package's current examples. */
export const storagePluginRedisCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  rediSearchVectorFeature: [
    {
      title: t('Rank with native FLOAT32 indices', '以原生 FLOAT32 索引排名'),
      problem: t(
        'A selected vector capability needs native ranking and pre-KNN filters.',
        '所选向量能力需要原生排名和 KNN 前过滤。'
      ),
      example: `import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { rediSearchVectorFeature } from '@migaia/storage-plugin-redis/features/search'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_STACK_URL! }, { maximum: 8 })
await pool.connect()
const host = await createStorageHost({ plugins: [redisBackendPlugin({ driver: nodeRedisDriver(pool), prefix: crypto.randomUUID() }, { search: rediSearchVectorFeature() })] as const })
const store = host.backend('redis')
try {
  const items = store.use(vector).collection<{ group: string }>('items', { dimensions: 2, metric: 'cosine' })
  await items.upsert([{ id: 'one', vector: [1, 0], payload: { group: 'docs' } }])
  console.log((await items.near([1, 0], { exact: true }).where({ group: 'docs' }).topK(1).all())[0]?.id)
  await store.use(ttl).expire({ channel: 'vector', collection: 'items', id: 'one' }, 60000)
} finally {
  await store.clearAll()
  await host.dispose()
  await pool.close()
}`,
      result: t(
        'Prints one. The native exact FLAT path filters the organization and payload before ranking.',
        '输出 one，原生 exact FLAT 路径在排名前过滤组织与 payload。'
      )
    }
  ],
  nativeFeatures: [
    {
      title: t('Compose independent native Features', '组合独立原生 Feature'),
      problem: t(
        'Business streams and committed storage replay have different native sources.',
        '业务 Stream 与存储提交重放使用不同原生来源。'
      ),
      example: `import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { durableChangeFeed } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { redisStreamsFeature } from '@migaia/storage-plugin-redis/features/streams'
import { redisPubSubFeature } from '@migaia/storage-plugin-redis/features/pubsub'
import { redisSortedSetsFeature } from '@migaia/storage-plugin-redis/features/sorted-sets'
import { redisRateLimitFeature } from '@migaia/storage-plugin-redis/features/rate-limit'
import { redisChangeStreamFeature } from '@migaia/storage-plugin-redis/features/change-stream'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! }, { maximum: 8 })
await pool.connect()
const host = await createStorageHost({ plugins: [redisBackendPlugin({
  driver: nodeRedisDriver(pool),
  prefix: process.env.MIGAIA_EXAMPLE_REDIS_PREFIX ?? crypto.randomUUID()
}, {
  streams: redisStreamsFeature(), pubsub: redisPubSubFeature(),
  scores: redisSortedSetsFeature(), rate: redisRateLimitFeature({ limit: 3, windowMs: 1000 }),
  history: redisChangeStreamFeature({ maxLen: 1000 })
})] as const })
const store = host.backend('redis')
try {
  const id = await store.api.streams.add('jobs', { body: new Uint8Array([1, 2]) })
  console.log((await store.api.streams.range('jobs'))[0]?.id === id)
  await store.api.sortedSets.add('scores', [{ member: 'one', score: 1 }])
  console.log((await store.api.sortedSets.top('scores'))[0]?.member)
  console.log((await store.api.rateLimit.consume('quota')).allowed)
  const subscription = await store.api.pubsub.subscribe('events', () => undefined)
  await store.api.pubsub.publish('events', new Uint8Array([3]))
  await subscription.dispose()
  await store.set('checkpoint', 'ready')
  console.log((await store.use(durableChangeFeed).readChanges()).changes.length)
} finally { await host.dispose(); await pool.close() }`,
      result: t(
        'Prints true, one, true and 1. Native data remains in the selected namespace after disposal.',
        '输出 true、one、true 与 1。释放后原生数据仍保留在所选 namespace。'
      )
    }
  ],
  redisBackendPlugin: [
    {
      title: t('Use the original native transaction', '使用原生事务'),
      problem: t(
        'A cache and its native expiry must commit together.',
        '缓存与原生期限必须一同提交。'
      ),
      example: `import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! }, { maximum: 8 })
await pool.connect()
const host = await createStorageHost({ plugins: [redisBackendPlugin({
  driver: nodeRedisDriver(pool), prefix: crypto.randomUUID()
})] as const })
const store = host.backend('redis')
try {
  await store.tx().lock({ channel: 'text', key: 'cache' }).run(async tx => {
    await tx.set('cache', 'ready')
    await tx.use(ttl).expire({ channel: 'text', key: 'cache' }, 60000)
  })
  console.log(await store.get('cache'))
} finally { await store.clearAll(); await host.dispose(); await pool.close() }`,
      result: t(
        'Prints ready; the caller retains client ownership.',
        '输出 ready；调用方仍拥有客户端。'
      )
    }
  ],
  ioredisDriver: [
    {
      title: t('Borrow an ioredis client', '借用 ioredis client'),
      problem: t(
        'The adapter must retain one real duplicate until the callback settles.',
        '适配器需要持有真实 duplicate，直到回调完成。'
      ),
      example: `import { Redis } from 'ioredis'
import { ioredisDriver } from '@migaia/storage-plugin-redis/ioredis'
const client = new Redis(process.env.MIGAIA_REDIS_URL!)
try {
  const driver = ioredisDriver(client)
  console.log(await driver.withConnection(connection => connection.command(['PING'])))
} finally { await client.quit() }`,
      result: t(
        'Prints PONG. The caller closes its own root client.',
        '输出 PONG，由调用方关闭原 root client。'
      )
    }
  ],
  nodeRedisDriver: [
    {
      title: t('Hold the native pool lease', '持有原生 pool 租约'),
      problem: t(
        'The complete callback must stay inside RedisClientPool.execute.',
        '完整回调必须位于 RedisClientPool.execute 内。'
      ),
      example: `import { createClientPool } from 'redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! })
await pool.connect()
try {
  const driver = nodeRedisDriver(pool)
  console.log(await driver.withConnection(connection => connection.command(['PING'])))
} finally { await pool.close() }`,
      result: t(
        'Prints PONG. The adapter returns the lease after the callback settles.',
        '输出 PONG，适配器在回调完成后归还租约。'
      )
    }
  ],
  bunRedisDriver: [
    {
      title: t('Use Bun’s built-in client', '使用 Bun 内置 client'),
      problem: t(
        'Text-wire storage must work without fabricating a binary command port.',
        '文本 wire 存储不能虚构二进制命令端口。'
      ),
      example: `import { RedisClient } from 'bun'
import { bunRedisDriver } from '@migaia/storage-plugin-redis/bun'
const client = new RedisClient(process.env.MIGAIA_REDIS_URL!)
await client.connect()
try {
  const driver = bunRedisDriver(client)
  console.log(await driver.withConnection(connection => connection.command(['PING'])))
} finally { client.close() }`,
      result: t(
        'Prints PONG. This adapter does not expose binaryCommand.',
        '输出 PONG，该适配器不提供 binaryCommand。'
      )
    }
  ]
}
