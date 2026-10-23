/** Redis protocol failures have one registered domain regardless of the selected native client. */
export const ERROR_SOURCE = 'storage.backend.redis' as const
/** Each native failure retains its original cause and command execution evidence. */
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
