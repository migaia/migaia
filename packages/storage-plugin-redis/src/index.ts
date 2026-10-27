export type {
  IRedisReply,
  IRedisExecEntry,
  IRedisBorrowedClient,
  IRedisConnection,
  IRedisDriver
} from './driver.js'

export { redisBackendKind, redisBackendPlugin } from './plugin.js'
export type {
  IRedisOptions,
  IRedisCapabilities,
  IRedisStore,
  IRedisTransactionScope
} from './types.js'
export type { IRedisCommandHookPayload, IRedisWatchConflictHookPayload } from './hooks.js'

export type {
  IRedisStreamEntry,
  IRedisStreamsApi,
  IRedisStreamsOutput
} from './features/streams.js'
export type { IRedisPubSubApi, IRedisPubSubOutput } from './features/pubsub.js'
export type { IRedisSortedSetsApi, IRedisSortedSetsOutput } from './features/sorted-sets.js'
export type {
  IRedisRateLimitOptions,
  IRedisRateLimitResult,
  IRedisRateLimitApi,
  IRedisRateLimitOutput
} from './features/rate-limit.js'
export type { IRedisChangeStreamOutput } from './features/change-stream.js'

export type { IRedisVectorFeatureOutput } from './features/search.js'
