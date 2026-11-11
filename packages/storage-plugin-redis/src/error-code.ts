/** Registered error domain of storage-plugin-redis; never names the package or a path. */
export const ERROR_SOURCE = 'storage.backend.redis'

/**
 * Each native failure retains its original cause and command execution evidence.
 *
 * @error-source storage.backend.redis
 */
export const RedisErrorCode = {
  /** Native command, connection or EXEC failure; unknown writes must never be replayed. */
  failed: 'REDIS_FAILED',
  /** Fixed protocol replies or persisted values cannot be decoded; inspect the original cause. */
  decodeFailed: 'DECODE_FAILED',
  /**
   * User callback, draft or finalizer failed without a native protocol failure; inspect the
   * original error.
   */
  transactionFailed: 'TRANSACTION_FAILED'
} as const
export type IRedisErrorCode = (typeof RedisErrorCode)[keyof typeof RedisErrorCode]
