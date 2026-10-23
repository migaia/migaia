# Redis native drivers

The adapter entries borrow a genuine connected SDK client or pool. `ioredisDriver` accepts ioredis 6, `nodeRedisDriver` accepts a node-redis 6 pool, and `bunRedisDriver` accepts Bun's built-in `RedisClient`. The root entry does not load an SDK.

`withConnection` holds the native pool lease or owned duplicate for the complete callback. The injected client remains caller-owned. Borrowed `getClient()` types omit connection closing and duplication methods. Subscription resources seal callbacks before cleanup and use cached disposal Promises.

`exec` returns `null` for an aborted WATCH, otherwise one success or original native error per command. A command error can leave other commands committed. A connection error after EXEC can have an unknown outcome; the adapters never replay it. ioredis and node-redis expose binary commands. Bun's driver rejects binary input before MULTI.

Native command, connection and EXEC failures use `REDIS_FAILED`. Unknown user callback failures use `TRANSACTION_FAILED`. Existing contract, host and package errors retain their identity; native Error types, stacks and original failures remain reachable.

The ioredis and node-redis `binaryCommand` and `exec` ports retain arbitrary native BLOB bytes. Ioredis success replies can also be Buffers; validate each `unknown` reply for its fixed command. The node-redis 6.3 multi builder omits the mapping on its final EXEC. The adapter uses native raw MULTI/EXEC inside the same genuine pool lease and reuses the SDK chainId. Original item Errors remain intact; no MultiErrorReply is fabricated when the SDK produces none. A connection change before EXEC rejects with `REDIS_FAILED`; only a native null EXEC means WATCH abort.

## Standard storage backend

`redisBackendPlugin({ driver, prefix?, concurrency?, owner?, maxLockMs? })` installs KV, bytes, records, TTL, counters, the original transaction builder and committed change hints. Defaults are `prefix: 'migaia'` and `maxLockMs: 30000`. Host detection requires Redis >=7.2 or Valkey >=7.2.5. With automatic detection disabled, call `await host.detect()` first. Each subscription holds its own native connection; reserve pool capacity for subscriptions and business operations.

```ts
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { counter, kv, records, ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL! }, { maximum: 8 })
await pool.connect()
const host = await createStorageHost({
  plugins: [
    redisBackendPlugin({
      driver: nodeRedisDriver(pool),
      prefix: crypto.randomUUID()
    })
  ] as const
})
const store = host.backend('redis')
try {
  await store.use(kv).setMany([{ key: ['cache', 1], value: 'one' }])
  await store.use(counter).increment('visits')
  await store
    .tx()
    .lock({ channel: 'text', key: 'session' })
    .run(async (tx) => {
      await tx.set('session', 'active')
      await tx.use(ttl).expire({ channel: 'text', key: 'session' }, 60000)
    })
  await store.putRecord({ active: true }, ['user', 1])
  console.log(await store.use(records).query().count())
} finally {
  await store.clearAll()
  await host.dispose()
  await pool.close()
}
```

Reads inside a transaction do not acquire locks. Explicit `.lock(...)` holds a native SET NX PX lease; ordinary writes follow the original concurrency policy. WATCH precedes dependent reads. Data, ordered indexes, revisions and notifications share one EXEC. Callback failure sends no EXEC; null is an actual WATCH abort. Per-command failure may partially commit. An unknown EXEC is never replayed and seals this installation's new write admission while allowing reads and disposal.

Channels have separate wires. Overwrites preserve TTL; `expire(0)` removes immediately. TTL and locks use Redis TIME/PTTL. Fractional milliseconds round upward to a native millisecond; unsafe absolute deadlines reject before EXEC. Batch writes reject canonically equivalent duplicate keys; empty batches send nothing and getMany preserves positions and duplicates.

P is the original canonical prefix encoding rendered as a nonempty `{hex}` hash tag. Every physical key shares its slot and logical keys include their organization, including the default organization.

| Data                 | Native type | Physical key                         |
| -------------------- | ----------- | ------------------------------------ |
| Text/bytes/records   | STRING      | P:t:orgKey / P:b:orgKey / P:r:orgKey |
| Ordered text/records | ZSET        | P:t:index / P:r:index                |
| Revisions            | HASH        | P:rev                                |
| Locks                | STRING      | P:lock:orgId:identity                |
| Commit hints         | Pub/Sub     | P:changes                            |

Prefix removal uses ZRANGEBYLEX, skips expired values and rechecks stale members. Lock inspection and byte clearing use SCAN, including all visited database candidates in their cost. Change hints are best-effort: external native writes, reconnect replay and timely expiry delivery are not promised. Explicit disposal caches its main Promise; symbolic disposal caches a separate reporting Promise. Cleanup releases owned subscriptions and leases without closing the injected client.
