export { ERROR_SOURCE, RedisErrorCode, type IRedisErrorCode } from './error-code.js'
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
