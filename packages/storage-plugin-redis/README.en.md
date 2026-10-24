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

| Data                        | Native type  | Physical key                         |
| --------------------------- | ------------ | ------------------------------------ |
| Text/bytes/records          | STRING       | P:t:orgKey / P:b:orgKey / P:r:orgKey |
| Ordered text/records        | ZSET         | P:t:index / P:r:index                |
| Vector points / 向量点      | HASH         | P:v:collectionHex:orgId:idHex        |
| Search schema / 检索 schema | native index | P:vi:collectionHex                   |
| Revisions                   | HASH         | P:rev                                |
| Locks                       | STRING       | P:lock:orgId:identity                |
| Commit hints                | Pub/Sub      | P:changes                            |

Prefix removal uses ZRANGEBYLEX, skips expired values and rechecks stale members. Lock inspection and byte clearing use SCAN, including all visited database candidates in their cost. Change hints are best-effort: external native writes, reconnect replay and timely expiry delivery are not promised. Explicit disposal caches its main Promise; symbolic disposal caches a separate reporting Promise. Cleanup releases owned subscriptions and leases without closing the injected client.

## Native Features

Select imports from independent subpaths as the second argument to `redisBackendPlugin`. Direct native APIs appear only on `store.api`, never `tx.api`; capability Features use their original tokens; fixed native APIs use the host's existing single pipeline. Streams/PubSub byte payloads use the sole canonical base64 text wire.

| Entry                     | API                                                                                    | Defaults and boundaries                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/features/streams`       | `redisStreamsFeature()`, `api.streams.add/range/createGroup/readGroup/ack/autoClaim`   | range -/+ and count100; group 0-0 and createStream=true; read count100, omitted block is nonblocking; only existing same-name BUSYGROUP is idempotent                 |
| `/features/pubsub`        | `redisPubSubFeature()`, `api.pubsub.publish/subscribe/keyspace`                        | Only expired/del/set; keyspace returns UTF-8 bytes of the actual physical key, filters namespace and child organization, and never changes notification configuration |
| `/features/sorted-sets`   | `redisSortedSetsFeature()`, `api.sortedSets.add/rank/top`                              | Finite scores; ascending top10; equal scores use original UTF16 key order; empty add sends nothing                                                                    |
| `/features/rate-limit`    | `redisRateLimitFeature({limit,windowMs})`, `api.rateLimit.consume`                     | Positive safe integers; cost1; atomic rejection does not increment; resetAfterMs is native PTTL                                                                       |
| `/features/change-stream` | `redisChangeStreamFeature({maxLen})`, `use(durableChangeFeed).readChanges/tailChanges` | Positive safe maxLen; read limit100; native Stream ID; data and XADD share one EXEC                                                                                   |
| `/features/search`        | `rediSearchVectorFeature()`, `use(vector).collection(name,options)`                    | Native module/binary port; HNSW default, exact FLAT; same original vector TTL draft                                                                                   |

Consumer-group blocking uses a dedicated genuine connection. Each native BLOCK lasts at most1000ms; only an actual empty reply continues waiting, while native failures reject without replay. Cancellation and shutdown drain the current blocking slice before returning its lease. Subscription cancellation budgets remain active until disposal. Callback rejection is reported without altering committed data.

The durable feed covers only standard library commits. `readChanges({after,limit})` reads after an exclusive cursor. `tailChanges({from:'now',onChange,onError})` captures the native high-water mark first, advances only after callback success, and reports/closes on failure without confirming it. A noninitial cursor before the retained first item raises `CHANGE_CURSOR_EXPIRED`. Initial `0-0` resumes only when native XINFO confirms that no entries were removed; trimming also expires this cursor. Reads crossing retention boundaries reject conservatively. MAXLEN uses native approximate trimming; external native commands do not fabricate standard changes.

```ts
import { createClientPool } from 'redis'
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
const host = await createStorageHost({
  plugins: [
    redisBackendPlugin(
      {
        driver: nodeRedisDriver(pool),
        prefix: process.env.MIGAIA_EXAMPLE_REDIS_PREFIX ?? crypto.randomUUID()
      },
      {
        streams: redisStreamsFeature(),
        pubsub: redisPubSubFeature(),
        scores: redisSortedSetsFeature(),
        rate: redisRateLimitFeature({ limit: 3, windowMs: 1000 }),
        history: redisChangeStreamFeature({ maxLen: 1000 })
      }
    )
  ] as const
})
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
} finally {
  await host.dispose()
  await pool.close()
}
```

## Native vector search

Select `rediSearchVectorFeature()` from `/features/search` to install `vector`. Detection requires the actual Search module and a genuine binary connection/EXEC port; Bun's built-in driver therefore rejects this selected Feature while base KV remains usable. Redis 8 may already include Search; Valkey without the module rejects it. No collection DDL runs during factory construction or detection. Configure dimensions and metric on a new collection; later hosts resolve the native schema through FT.INFO.

Managed points are native HASHes. One EXEC writes the same FLOAT32 bytes to HNSW and FLAT fields; `exact:true` selects FLAT. Scores are cosine `1-distance`, dot `1-distance`, and euclid `-sqrt(distance)`. Inputs that overflow FLOAT32, or become a zero cosine direction after conversion, reject before point modification. Payload truth uses the original portable codec. New scalar paths register native TAG/NUMERIC fields with FT.ALTER before upsert; there is no second schema registry. Index and document names use the original canonical namespace and portable collection/id encoding, keeping arbitrary UTF16 string identities.

Organization TAG and native expiry NUMERIC filters run before KNN. Scalar equality/membership/presence and numeric ranges use faithful native filters. Unsupported conditions and function predicates process only engine hits, without refilling; `requirePushdown()` rejects before native I/O. `minScore` remains a bounded client threshold and explain reports that boundary. Similar/recommend reads only the named samples and uses the original recommendation helper before the same native query.

Vector TTL uses the same original WATCH draft and lock owner as other channels. Redis TIME supplies one absolute deadline, written as both HASH expiry and PEXPIREAT in the same EXEC. Ordinary upsert preserves the deadline; persist sets expiry=0 and PERSIST together. Both root and authentic transaction TTL methods support vector targets. Vector collections have no generic transaction capability. Successful vector mutations publish the original broad invalidation and selected durable commit summary.

Search truncates TAG tokens at 4096 bytes. Canonical scalar equality/membership values beyond that boundary are not native pushdown candidates. `.near().where(...)` filters only native topK hits without refilling; `requirePushdown()` reports `QUERY_NOT_PUSHABLE`, while `deleteWhere` and native `search.filter` reject with `UNSUPPORTED_CAPABILITY` before I/O. This native long-value filter combination awaits user review. Complete payloads, IDs and physical keys are retained. Sample exclusion uses a short SHA-256 TAG over the complete original ID codec bytes; it is an index projection, not reversible ID encoding or a mathematical collision-free guarantee.

`deleteWhere(where,{count?})` defaults to precount. Both precount and scroll collect native FT.SEARCH pages then delete actual existing points in the original attempt, with no extra count command and no expiry filter. Already expired HASHes are absent and do not count. Unsupported conditions reject before native I/O. `dropOrg` deletes only managed HASHes in that organization and retains shared collection schema, including after reopening without Search selected or without a binary port. Cleanup uses only the original identity metadata, WATCH/revisions and the same EXEC. Search cost is the native engine plan plus returned hit bytes; deletion cost includes its actual native pages and selected point drafts.

```ts
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { vector, ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { rediSearchVectorFeature } from '@migaia/storage-plugin-redis/features/search'
const pool = createClientPool({ url: process.env.MIGAIA_REDIS_STACK_URL! }, { maximum: 8 })
await pool.connect()
const host = await createStorageHost({
  plugins: [
    redisBackendPlugin(
      { driver: nodeRedisDriver(pool), prefix: crypto.randomUUID() },
      { search: rediSearchVectorFeature() }
    )
  ] as const
})
const store = host.backend('redis')
try {
  const items = store
    .use(vector)
    .collection<{ group: string }>('items', { dimensions: 2, metric: 'cosine' })
  await items.upsert([{ id: 'one', vector: [1, 0], payload: { group: 'docs' } }])
  console.log(
    (await items.near([1, 0], { exact: true }).where({ group: 'docs' }).topK(1).all())[0]?.id
  )
  await store.use(ttl).expire({ channel: 'vector', collection: 'items', id: 'one' }, 60000)
} finally {
  await store.clearAll()
  await host.dispose()
  await pool.close()
}
```

## Commit-only external journal

Host `journal` may borrow the original Logger with only `binlog`, without WAL, undo or atomic log stores. Each organization captures its final draft through the original journalBinding. Only a fully successful native EXEC triggers onCommit, and the operation awaits its original settle. Callback failure before EXEC writes neither data nor log; partial execution or an unknown reply appends no success log, never replays, and seals subsequent writes. External append failures use the host's report path; committed data is not described as rolled back. The existing post-commit logging window remains.

The terminal declares `nativeAtomic:false`; execution isolation does not imply failure rollback. Standard value, byte, record and vector images use the original portable codec with native wire and absolute expiry. Additional PEXPIRETIME capture runs only when journaling is active. Complete before-images for historical vector removal require the genuine binary port; without it, that new journal combination rejects with `UNSUPPORTED_CAPABILITY` before modification, while ordinary historical removal remains supported.

`indexExclusive:false` separately isolates storageLogStore's lifetime-cached index. Strong same-EXEC atomic binlog, undo and WAL intent/marker combinations reject during preparation and await user review. These previously undelivered guarantees are not represented as implemented. The original owner can remove isolation after providing the actual required guarantees; no second journal or transaction platform is added. Native Streams/PubSub/sorted-set/rate-limit APIs retain their behavior without claiming to be standard business-channel journal sources.
