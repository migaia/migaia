/** Stable protocol words are shared by adapters and the fixed-command backend. */
export const RedisCommand = {
  multi: 'MULTI',
  exec: 'EXEC',
  discard: 'DISCARD',
  unwatch: 'UNWATCH'
} as const
/** Native subscription callbacks and fixed reply diagnostics share one owner. */
export const RedisText = {
  backend: 'redis',
  failed: 'Redis operation failed',
  decodeFailed: 'Redis reply or persisted value is invalid',
  argument: 'Redis command arguments are invalid',
  transactionFailed: 'Redis transaction failed',
  message: 'message',
  error: 'error'
} as const
/** Original SDK aggregate evidence travels with its actual EXEC reply, without a registry. */
export const redisExecCause = Symbol('redis-exec-cause')
