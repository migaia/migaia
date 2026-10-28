export type {
  IRedisReply,
  IRedisExecEntry,
  IRedisBorrowedClient,
  IRedisConnection,
  IRedisDriver
} from './driver.ts'

export { redisBackendKind, redisBackendPlugin } from './plugin.ts'
export type {
  IRedisOptions,
  IRedisCapabilities,
  IRedisStore,
  IRedisTransactionScope
} from './types.ts'
export type { IRedisCommandHookPayload, IRedisWatchConflictHookPayload } from './hooks.ts'

export type {
  IRedisStreamEntry,
  IRedisStreamsApi,
  IRedisStreamsOutput
} from './features/streams.ts'
export type { IRedisPubSubApi, IRedisPubSubOutput } from './features/pubsub.ts'
export type { IRedisSortedSetsApi, IRedisSortedSetsOutput } from './features/sorted-sets.ts'
export type {
  IRedisRateLimitOptions,
  IRedisRateLimitResult,
  IRedisRateLimitApi,
  IRedisRateLimitOutput
} from './features/rate-limit.ts'
export type { IRedisChangeStreamOutput } from './features/change-stream.ts'

export type { IRedisVectorFeatureOutput } from './features/search.ts'
