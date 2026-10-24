import {
  postgresBackendPlugin,
  postgresBackendKind,
  type IPgDriver
} from '@migaia/storage-plugin-postgres'
import { createStorageHost, memoryBackendKind, type IStorageFeature } from '@migaia/storage-host'
import {
  durableChangeFeed,
  vector,
  kv,
  records,
  ttl,
  counter,
  isKeyValueStore,
  isRecordStore,
  asRecordStore
} from '@migaia/storage-contract'
import { redisBackendPlugin, type IRedisDriver } from '../src/index.js'
import { redisStreamsFeature } from '../src/features/streams.js'
import { redisPubSubFeature } from '../src/features/pubsub.js'
import { redisSortedSetsFeature } from '../src/features/sorted-sets.js'
import { redisRateLimitFeature } from '../src/features/rate-limit.js'
import { redisChangeStreamFeature } from '../src/features/change-stream.js'
import { rediSearchVectorFeature } from '@migaia/storage-plugin-redis/features/search'

/** Ambient clients make these declaration consumers compile without starting a service. */
declare const driver: IRedisDriver
/** PostgreSQL remains an incompatible exact Feature target even when its native driver is valid. */
declare const pgDriver: IPgDriver
/** Three independent IDs retain their exact selected native API and capability surfaces. */
const host = await createStorageHost({
  plugins: [
    redisBackendPlugin(
      { driver, id: 'one' },
      {
        streams: redisStreamsFeature(),
        pubsub: redisPubSubFeature(),
        sorted: redisSortedSetsFeature(),
        rate: redisRateLimitFeature({ limit: 3, windowMs: 1000 }),
        history: redisChangeStreamFeature({ maxLen: 100 }),
        search: rediSearchVectorFeature()
      }
    ),
    redisBackendPlugin(
      { driver, id: 'two' },
      {
        streams: redisStreamsFeature(),
        pubsub: redisPubSubFeature(),
        sorted: redisSortedSetsFeature(),
        rate: redisRateLimitFeature({ limit: 3, windowMs: 1000 }),
        history: redisChangeStreamFeature({ maxLen: 100 }),
        search: rediSearchVectorFeature()
      }
    ),
    redisBackendPlugin(
      { driver, id: 'three' },
      {
        streams: redisStreamsFeature(),
        pubsub: redisPubSubFeature(),
        sorted: redisSortedSetsFeature(),
        rate: redisRateLimitFeature({ limit: 3, windowMs: 1000 }),
        history: redisChangeStreamFeature({ maxLen: 100 }),
        search: rediSearchVectorFeature()
      }
    )
  ] as const
})
for (const store of [host.backend('one'), host.backend('two'), host.backend('three')]) {
  const stream: Promise<string> = store.api.streams.add('jobs', { body: new Uint8Array() })
  const rank: Promise<number | undefined> = store.api.sortedSets.rank('scores', 'one')
  const messages: Promise<number> = store.api.pubsub.publish('events', new Uint8Array())
  const replay = store.use(durableChangeFeed).readChanges()
  const collection = store
    .use(vector)
    .collection<{ tag: string }>('vectors', { dimensions: 2, metric: 'dot' })
  const hits = collection.near([1, 0]).topK(1).all()
  // @ts-expect-error RediSearch does not expose native groupBy.
  collection.near([1, 0]).topK(1).groupBy('tag')
  void hits
  void [stream, rank, messages, replay, store.api.rateLimit.consume('quota')]
  await store.transaction(async (scope) => {
    // @ts-expect-error Vector collections have no generic transaction projection.
    scope.use(vector).collection('vectors')
    await scope.set('key', 'value')
    // @ts-expect-error Native Feature APIs cannot return interactive WATCH draft results.
    scope.api.streams.add('jobs', {})
  })
}
// @ts-expect-error Feature target identity cannot be changed to memory.
const wrong: IStorageFeature<typeof memoryBackendKind> = redisStreamsFeature()
// @ts-expect-error Standard vector Feature targets only the Redis backend.
const wrongVector: IStorageFeature<typeof memoryBackendKind> = rediSearchVectorFeature()
void wrongVector
void wrong
// @ts-expect-error Backend IDs remain the exact three registered literals.
host.backend('other')

/** Default identity and original guarded/builder projections remain exact without selected Features. */
const defaultHost = await createStorageHost({ plugins: [redisBackendPlugin({ driver })] as const })
const defaults = defaultHost.backend('redis')
// @ts-expect-error Default identity must not widen to arbitrary strings.
defaultHost.backend('other')
for (const key of ['one', 'two', 'three'] as const) {
  await defaults.use(kv).getMany([key, key])
  await defaults.use(records).query<{ count: number }>().where({ count: 1 }).all()
  const changes = defaults.use(records).query<{ count: number }>().watch()
  await changes.dispose()
  await defaults.use(ttl).expire({ channel: 'record', key }, 1000)
  await defaults.use(counter).increment(key)
  await defaults
    .tx()
    .lock({ channel: 'text', key })
    .run(async (scope) => {
      await scope.use(kv).setMany([{ key, value: 'value' }])
      await scope.use(records).query<{ count: number }>().all()
      await scope.use(ttl).persist({ channel: 'text', key })
      await scope.use(counter).increment(key)
    })
  if (isKeyValueStore(defaults) && isRecordStore(defaults)) {
    const record = asRecordStore<{ count: number }>(defaults)
    await record.getRecord(key)
  }
}
// @ts-expect-error The original unlocked builder has no terminal.
defaults.tx().run(() => undefined)
// @ts-expect-error TTL targets retain the canonical channel-specific shape.
defaults.use(ttl).expire({ channel: 'vector', key: 'wrong' }, 1000)

// @ts-expect-error A Redis Stream Feature cannot satisfy the PostgreSQL backend kind.
const wrongPostgres: IStorageFeature<typeof postgresBackendKind> = redisStreamsFeature()
// @ts-expect-error The public PostgreSQL factory rejects the Redis Stream Feature selection.
postgresBackendPlugin({ driver: pgDriver }, { streams: redisStreamsFeature() })
void wrongPostgres
