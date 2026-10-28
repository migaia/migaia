import assert from 'node:assert/strict'
import { createClientPool } from 'redis'
import Redis from 'ioredis'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { kv, records, ttl, counter, vector, durableChangeFeed } from '@migaia/storage-contract'
import { encodeOrderedStorageKey } from '@migaia/storage-host/sdk'
import { redisBackendPlugin, type IRedisDriver } from '@migaia/storage-plugin-redis'
import { STORAGE_REDIS_ERROR_SOURCE } from '@migaia/storage-contract/error-code'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { ioredisDriver } from '@migaia/storage-plugin-redis/ioredis'
import { bunRedisDriver } from '@migaia/storage-plugin-redis/bun'
import { redisStreamsFeature } from '@migaia/storage-plugin-redis/features/streams'
import { redisPubSubFeature } from '@migaia/storage-plugin-redis/features/pubsub'
import { redisSortedSetsFeature } from '@migaia/storage-plugin-redis/features/sorted-sets'
import { redisRateLimitFeature } from '@migaia/storage-plugin-redis/features/rate-limit'
import { redisChangeStreamFeature } from '@migaia/storage-plugin-redis/features/change-stream'
import { rediSearchVectorFeature } from '@migaia/storage-plugin-redis/features/search'

assert.equal(STORAGE_REDIS_ERROR_SOURCE, 'storage.backend.redis')
/** Built public entries consume genuine clients in every runtime; only Bun loads its native SDK. */
for (const service of [
  'MIGAIA_REDIS_URL',
  'MIGAIA_VALKEY_URL',
  'MIGAIA_REDIS_STACK_URL'
] as const) {
  const url = process.env[service]
  assert.ok(url, 'Real Redis service URL is required')
  for (const adapter of ['node', 'ioredis', ...(typeof Bun === 'undefined' ? [] : ['bun'])]) {
    const pool = createClientPool({ url }, { maximum: 8 }),
      client = new Redis(url, { lazyConnect: true }),
      native = adapter === 'bun' ? new (await import('bun')).RedisClient(url) : undefined
    let driver: IRedisDriver
    if (adapter === 'node') {
      await pool.connect()
      driver = nodeRedisDriver(pool)
    } else if (adapter === 'ioredis') {
      await client.connect()
      driver = ioredisDriver(client)
    } else {
      await native!.connect()
      driver = bunRedisDriver(native!)
    }
    const prefix = crypto.randomUUID(),
      tag = '{' + Buffer.from(encodeOrderedStorageKey(prefix, undefined)).toString('hex') + '}',
      hasVector = adapter !== 'bun' && service !== 'MIGAIA_VALKEY_URL',
      host = await createStorageHost({
        plugins: [
          redisBackendPlugin(
            { driver, prefix },
            {
              streams: redisStreamsFeature(),
              pubsub: redisPubSubFeature(),
              sorted: redisSortedSetsFeature(),
              rate: redisRateLimitFeature({ limit: 2, windowMs: 10000 }),
              durable: redisChangeStreamFeature({ maxLen: 1000 })
            }
          )
        ] as const
      })
    try {
      const store = host.backend('redis'),
        org = host.org(createOrgId()).backend('redis')
      await store.use(kv).set('value', 'root')
      await org.use(kv).set('value', 'org')
      assert.equal(await store.get('value'), 'root')
      assert.equal(await org.get('value'), 'org')
      await store.setBytes('bytes', new Uint8Array([255, 0, 128]))
      assert.deepEqual(await store.getBytes('bytes'), new Uint8Array([255, 0, 128]))
      await store.transaction(async (scope) => {
        await scope.putRecord({ count: 1 }, ['item', 1])
        assert.equal((await scope.use(records).query().all()).length, 1)
        await scope.set('transaction', 'committed')
      })
      assert.equal(await store.get('transaction'), 'committed')
      assert.equal(await store.use(counter).increment('counter', 2), 2)
      assert.equal(await store.use(ttl).expire({ channel: 'text', key: 'value' }, 10000), true)
      assert.equal(await store.use(ttl).persist({ channel: 'text', key: 'value' }), true)
      const streamId = await store.api.streams.add('jobs', { body: new Uint8Array([255, 0]) })
      assert.equal((await store.api.streams.range('jobs'))[0]?.id, streamId)
      await store.api.sortedSets.add('scores', [{ member: '\ud800', score: 1 }])
      assert.equal((await store.api.sortedSets.top('scores'))[0]?.member, '\ud800')
      assert.equal((await store.api.rateLimit.consume('quota')).allowed, true)
      const received = Promise.withResolvers<Uint8Array>(),
        subscription = await store.api.pubsub.subscribe('events', (value) =>
          received.resolve(value)
        )
      try {
        await store.api.pubsub.publish('events', new Uint8Array([128, 255]))
        assert.deepEqual(await received.promise, new Uint8Array([128, 255]))
      } finally {
        await subscription.dispose()
      }
      assert.ok((await store.use(durableChangeFeed).readChanges()).changes.length >= 4)
      if (hasVector) {
        const vectorHost = await createStorageHost({
          plugins: [
            redisBackendPlugin({ driver, prefix }, { search: rediSearchVectorFeature() })
          ] as const
        })
        try {
          const collection = vectorHost
            .backend('redis')
            .use(vector)
            .collection('items', { dimensions: 2, metric: 'cosine' })
          await collection.upsert([
            { id: 'sample', vector: [1, 0] },
            { id: 'hit', vector: [0, 1] }
          ])
          assert.equal((await collection.similarTo('sample').topK(1).all())[0]?.id, 'hit')
          assert.equal(await collection.deleteWhere({}), 2)
        } finally {
          await vectorHost.dispose()
        }
      }
      console.log(
        JSON.stringify({
          runtime:
            typeof Bun !== 'undefined' ? 'bun' : Reflect.has(globalThis, 'Deno') ? 'deno' : 'node',
          service,
          adapter,
          result: 'PASS'
        })
      )
    } finally {
      await host.dispose()
      if (hasVector) {
        const indexes = (await driver.command(['FT._LIST'])) as string[]
        for (const index of indexes)
          if (index.startsWith(tag + ':vi:')) await driver.command(['FT.DROPINDEX', index])
      }
      let cursor = '0'
      do {
        const reply = (await driver.command([
          'SCAN',
          cursor,
          'MATCH',
          tag + ':*',
          'COUNT',
          '256'
        ])) as [string, string[]]
        cursor = reply[0]
        if (reply[1].length) await driver.command(['DEL', ...reply[1]])
      } while (cursor !== '0')
      if (pool.isOpen) await pool.close()
      client.disconnect()
      native?.close()
    }
  }
}
