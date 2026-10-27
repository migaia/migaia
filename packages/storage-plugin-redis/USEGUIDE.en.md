# Redis usage guide

[中文](./USEGUIDE.md)

These complete programs need Redis 7.2+ or Valkey 7.2.5+ and REDIS_URL. Set REDIS_SEARCH_URL for the vector example to a service that actually provides Search. Programs write data. Release the host before closing its caller-created pool.

## Find a scenario

| Need                                             | Section                                                         |
| ------------------------------------------------ | --------------------------------------------------------------- |
| Sessions, expiry, counters and tenant isolation  | [Organization data with expiry](#organization-data-with-expiry) |
| Application queues, messages, rankings or quotas | [Select native features](#select-native-features)               |
| Resume standard commit history                   | [Resume change history](#resume-change-history)                 |
| Server-side nearest-neighbor search              | [Search vectors](#search-vectors)                               |

## Organization data with expiry

Expected output: active, then 1. The explicit lock protects a logical key; organization IDs are UUIDs.

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { kv, ttl, counter } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/sdk'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
const pool = createClientPool({ url: process.env.REDIS_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [redisBackendPlugin({ driver: nodeRedisDriver(pool) })] as const
  })
  const store = host.org('10000000-0000-4000-8000-000000000001').backend('redis')
  await store
    .tx()
    .lock(lockKey.text('example:session'))
    .run(async (tx) => {
      await tx.use(kv).setMany([{ key: 'example:session', value: 'active' }])
      await tx.use(ttl).expire(lockKey.text('example:session'), 60000)
      await tx.set('example:visits', '0')
      await tx.use(counter).increment('example:visits')
    })
  console.log(await store.get('example:session'))
  console.log(await store.get('example:visits'))
} finally {
  await pool.close()
}
```

Overwriting a live value retains TTL; expire(0) deletes immediately. Expiry and locks use Redis TIME/PTTL. Fractional milliseconds round up; unsafe absolute deadlines reject before EXEC. getMany retains order, duplicates and missing positions. Batch writes reject equivalent duplicate keys; empty batches issue no commands. Standard KV, records, TTL and counters also work on tx. Text, bytes and records use separate channels.

Organizations share a hash-tagged physical namespace so related keys stay in one cluster slot. Keys, expiry, revisions and locks remain organization-specific. Prefix defaults to migaia, maxLockMs to 30000; concurrency selects a conflict policy. dropOrg removes the organization's standard data plus existing Streams, sorted-set, quota and vector points, even if a later installation no longer selects those Features. It retains other organizations, unmanaged application keys and shared Search schemas. clearAll keeps its standard-channel scope.

## Transactions and concurrency

Transaction reads do not automatically lock keys. Explicit lock uses SET NX PX; ordinary writes use the selected concurrency policy. WATCH starts before dependent reads. Values, indexes, revisions and notifications enter one EXEC. A callback failure before EXEC writes nothing. Only a native null EXEC proves a WATCH abort and can enter ordinary conflict retry handling.

An EXEC item error may leave partial writes. A disconnect after sending EXEC may leave an unknown result. Neither is automatically replayed; new writes for that installation are sealed while reads and disposal remain available. transactions:true is not a promise of complete rollback after native execution errors. Keep external effects outside callbacks that may retry.

## Select native features

The program selects four Features and writes a Stream entry, ranking, quota and message. In a fresh namespace, typical output is true, Ada, true,3. Existing entries and an unexpired quota can affect later runs.

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { redisStreamsFeature } from '@migaia/storage-plugin-redis/features/streams'
import { redisPubSubFeature } from '@migaia/storage-plugin-redis/features/pubsub'
import { redisSortedSetsFeature } from '@migaia/storage-plugin-redis/features/sorted-sets'
import { redisRateLimitFeature } from '@migaia/storage-plugin-redis/features/rate-limit'
const pool = createClientPool({ url: process.env.REDIS_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [
      redisBackendPlugin(
        { driver: nodeRedisDriver(pool), prefix: 'example-features' },
        {
          streams: redisStreamsFeature(),
          pubsub: redisPubSubFeature(),
          scores: redisSortedSetsFeature(),
          rate: redisRateLimitFeature({ limit: 3, windowMs: 1000 })
        }
      )
    ] as const
  })
  const store = host.backend('redis')
  const id = await store.api.streams.add('jobs', { body: new Uint8Array([1, 2]) })
  console.log((await store.api.streams.range('jobs')).some((entry) => entry.id === id))
  await store.api.sortedSets.add('scores', [{ member: 'Ada', score: 1 }])
  console.log((await store.api.sortedSets.top('scores'))[0]?.member)
  console.log((await store.api.rateLimit.consume('quota')).allowed)
  const message = Promise.withResolvers<Uint8Array>()
  await using subscription = await store.api.pubsub.subscribe('events', message.resolve)
  await store.api.pubsub.publish('events', new Uint8Array([3]))
  console.log((await message.promise)[0])
} finally {
  await pool.close()
}
```

| Feature     | Methods and defaults                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| streams     | add/range/createGroup/readGroup/ack/autoClaim; range-/+ and count 100; group 0-0 with createStream:true; read count 100, nonblocking when block is omitted |
| pubsub      | publish/subscribe/keyspace; binary messages use canonical base64 text; keyspace supports expired/del/set and returns actual physical-key UTF-8 bytes       |
| sorted-sets | add/rank/top; finite scores, ascending top 10, UTF-16 logical-member order for ties, no command for empty add                                              |
| rate-limit  | positive safe limit/windowMs, consume cost 1 by default; rejection does not increase the count, resetAfterMs comes from PTTL                               |

These APIs appear on store.api, not tx.api. Application Streams and Pub/Sub retain their own delivery semantics and do not automatically become standard commit logs. Subscriptions need dedicated real connections. Release the subscription, then the host, then the SDK. Keyspace notifications filter the namespace/organization without changing server notification configuration.

Blocking group reads hold a dedicated connection. Each native BLOCK is at most 1000 ms; only empty replies continue waiting. Native failures reject immediately. Cancellation and disposal drain the current blocking slice. Pub/Sub callback rejection only reports and cannot undo a committed publication.

## Resume change history

Select change-stream so standard writes and history XADD share one EXEC. This starts at the actual high-water position, waits for a standard commit and prints its server-assigned cursor.

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { durableChangeFeed } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { redisChangeStreamFeature } from '@migaia/storage-plugin-redis/features/change-stream'
const pool = createClientPool({ url: process.env.REDIS_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [
      redisBackendPlugin(
        { driver: nodeRedisDriver(pool), prefix: 'example-history' },
        { history: redisChangeStreamFeature({ maxLen: 1000 }) }
      )
    ] as const
  })
  const store = host.backend('redis')
  const received = Promise.withResolvers<void>()
  await using tail = await store.use(durableChangeFeed).tailChanges({
    from: 'now',
    onChange: async (change) => {
      console.log(change.cursor)
      received.resolve()
    },
    onError: (error) => {
      received.reject(error)
    }
  })
  await store.set('example:checkpoint', 'ready')
  await received.promise
} finally {
  await pool.close()
}
```

maxLen is a positive safe integer and uses native approximate MAXLEN trimming. readChanges({after,limit}) defaults to 100 and reads after the exclusive cursor. Finish derived effects and checkpoint persistence before a tail callback succeeds. Tail advances only after onChange succeeds; rejection reports and closes without skipping the failed item. Cursors are native Stream IDs; preserve strings rather than converting them into imprecise numbers.

A noninitial cursor behind retained history raises CHANGE_CURSOR_EXPIRED. 0-0 does not bypass lost history: it resumes only when XINFO proves nothing has been removed, and rejects after trimming. Crossing a trim boundary also rejects conservatively. This history covers standard library commits, not external native commands or immediate natural-expiry events. Ordinary best-effort change hints cannot replace it.

## Search vectors

The service needs the actual Search module and the driver needs binary connection/EXEC ports. Some Redis 8 deployments include Search; a Valkey deployment without the module rejects this Feature. Bun's adapter lacks those binary ports, so it cannot run this example, while its basic KV remains available. Expected output: guide.

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { rediSearchVectorFeature } from '@migaia/storage-plugin-redis/features/search'
const pool = createClientPool({ url: process.env.REDIS_SEARCH_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [
      redisBackendPlugin(
        { driver: nodeRedisDriver(pool), prefix: 'example-vectors' },
        { search: rediSearchVectorFeature() }
      )
    ] as const
  })
  const store = host.backend('redis')
  const items = store
    .use(vector)
    .collection<{ category: string }>('documents', { dimensions: 2, metric: 'cosine' })
  await items.upsert([{ id: 'guide', vector: [1, 0], payload: { category: 'guide' } }])
  const hits = await items.near([1, 0], { exact: true }).where({ category: 'guide' }).topK(1).all()
  console.log(hits[0]?.id)
  await store.use(ttl).expire({ channel: 'vector', collection: 'documents', id: 'guide' }, 60000)
} finally {
  await pool.close()
}
```

New collections specify dimensions and metric; later connections read the real schema through FT.INFO. Approximate search uses HNSW; exact:true uses FLAT. Both fields receive identical FLOAT32 bytes. Cosine/dot score is 1-distance; Euclidean score is -sqrt(distance). FLOAT32 overflow and cosine directions that become zero after conversion reject before modification.

Organization TAG and expiry NUMERIC filters apply inside native KNN ranking. Faithful scalar conditions push down; other conditions and functions filter engine hits without refill. requirePushdown rejects client conditions before I/O; minScore is a bounded client threshold. Full payloads retain portable encoding while scalar index fields are added with FT.ALTER. Similar/recommend reads the specified samples, constructs a direction and uses the same native query without promising extra candidates.

Search TAG tokens are limited to 4096 bytes. Longer canonical equality/member conditions are not declared pushable. Ordinary where can still filter topK hits; requirePushdown raises QUERY_NOT_PUSHABLE, and deleteWhere/native search.filter raise UNSUPPORTED_CAPABILITY before I/O. Full payloads, IDs and physical keys are not truncated. Sample exclusion uses SHA-256 short TAGs without promising mathematically collision-free identity.

Vector TTL uses the same WATCH/EXEC path: Redis TIME supplies an absolute deadline, HASH metadata and PEXPIREAT change together, ordinary upsert retains expiry, and persist clears both deadline fields and native expiry. Root and real transaction TTL accept vector targets; collections do not gain general transaction support. deleteWhere defaults to precount. Both count modes page through actual points before deletion and return only existing committed deletions. Already expired native HASHes do not count.

## Drivers, disposal and failures

Host detection runs automatically by default. With autoDetect:false, await host.detect() before using the selected backend capabilities. A version check does not imply a Search module is installed.

nodeRedisDriver accepts a node-redis 6 pool; ioredisDriver accepts an ioredis 6 client; bunRedisDriver accepts Bun RedisClient. Import them from /node-redis, /ioredis and /bun. Inject connected clients; the adapters never close the supplied root object. Owned ioredis connections disable replay of unacknowledged commands. node-redis retains one pool lease and per-item EXEC errors. Bun rejects binary input before MULTI. The root entry loads no SDK; reserve one connection per subscription.

Standard record field queries run on the client. Standard secondary indexes, SQL and RDF are absent. Missing text/bytes return null; missing records return undefined. Native indexes can retain expired entries and reads check actual keys. Prefix deletion uses an ordered index; lock inspection and some clearing use SCAN, whose cost includes real candidates visited.

Package failures use source storage.backend.redis: REDIS_FAILED for commands/connections/EXEC, TRANSACTION_FAILED for uncategorized business callback/draft failures, DECODE_FAILED for malformed replies or stored data. Existing shared, host and Redis errors retain identity and the original error remains reachable through cause. Repeated dispose returns one main Promise; symbolic release has a separate report-only Promise. Cleanup releases only subscriptions and leases the adapter created.

## Optional journal limits

Host journal configuration supports post-commit external binlog and telemetry. A success log is appended only after every EXEC item succeeds; partial or unknown outcomes do not append success or replay. Binlog failure reports but cannot roll back committed data: external append is not atomic with business writes. Standard values, bytes, records and vector images retain actual wire values and absolute expiry. Complete before images for historical vector deletion require binary ports; without them that logging combination rejects before modification.

The backend declares nativeAtomic:false. Combinations requiring strongly atomic binlog in the same EXEC, WAL intent/marker or undo currently reject and must not be treated as supported. Import storageLogStore separately from `@migaia/storage-host/plugins/journal`; it reads the current private index for every operation. Multiple instances may share a namespace and sequence without a cross-operation index cache. Native Feature APIs are not standard business-channel journal sources. Telemetry is opt-in and records each root operation or whole transaction once across retries. The application releases its logger and log storage after the host.
