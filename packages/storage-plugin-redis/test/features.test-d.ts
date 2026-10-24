import { createStorageHost, memoryBackendKind, type IStorageFeature } from '@migaia/storage-host'
import { durableChangeFeed, vector } from '@migaia/storage-contract'
import { redisBackendPlugin, type IRedisDriver } from '../src/index.js'
import { redisStreamsFeature } from '../src/features/streams.js'
import { redisPubSubFeature } from '../src/features/pubsub.js'
import { redisSortedSetsFeature } from '../src/features/sorted-sets.js'
import { redisRateLimitFeature } from '../src/features/rate-limit.js'
import { redisChangeStreamFeature } from '../src/features/change-stream.js'
import { rediSearchVectorFeature } from '@migaia/storage-plugin-redis/features/search'

/** Ambient clients make these declaration consumers compile without starting a service. */
declare const driver: IRedisDriver
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
