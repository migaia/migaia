/** Stable protocol words are shared by adapters and the fixed-command backend. */
export const RedisCommand = {
  /** Native BLOCK protocol word used by fixed Redis endpoints. */
  block: 'BLOCK',
  /** Native COUNT protocol word used by fixed Redis endpoints. */
  count: 'COUNT',
  /** Native CREATE protocol word used by fixed Redis endpoints. */
  create: 'CREATE',
  /** Native DEL protocol word used by fixed Redis endpoints. */
  del: 'DEL',
  /** Native EVAL protocol word used by fixed Redis endpoints. */
  eval: 'EVAL',
  /** Native GET protocol word used by fixed Redis endpoints. */
  get: 'GET',
  /** Native GROUP protocol word used by fixed Redis endpoints. */
  group: 'GROUP',
  /** Native HGET protocol word used by fixed Redis endpoints. */
  hget: 'HGET',
  /** Native HINCRBY protocol word used by fixed Redis endpoints. */
  hincrby: 'HINCRBY',
  /** Native HMGET protocol word used by fixed Redis endpoints. */
  hmget: 'HMGET',
  /** Native HSET protocol word used by fixed Redis endpoints. */
  hset: 'HSET',
  /** Native INFO protocol word used by fixed Redis endpoints. */
  info: 'INFO',
  /** Native KEEPTTL protocol word used by fixed Redis endpoints. */
  keepttl: 'KEEPTTL',
  /** Native LIMIT protocol word used by fixed Redis endpoints. */
  limit: 'LIMIT',
  /** Native MATCH protocol word used by fixed Redis endpoints. */
  match: 'MATCH',
  /** Native MGET protocol word used by fixed Redis endpoints. */
  mget: 'MGET',
  /** Native MKSTREAM protocol word used by fixed Redis endpoints. */
  mkstream: 'MKSTREAM',
  /** Native NX protocol word used by fixed Redis endpoints. */
  nx: 'NX',
  /** Native OK protocol word used by fixed Redis endpoints. */
  ok: 'OK',
  /** Native PERSIST protocol word used by fixed Redis endpoints. */
  persist: 'PERSIST',
  /** Native PEXPIREAT protocol word used by fixed Redis endpoints. */
  pexpireat: 'PEXPIREAT',
  /** Native PTTL protocol word used by fixed Redis endpoints. */
  pttl: 'PTTL',
  /** Native PUBLISH protocol word used by fixed Redis endpoints. */
  publish: 'PUBLISH',
  /** Native PX protocol word used by fixed Redis endpoints. */
  px: 'PX',
  /** Native SCAN protocol word used by fixed Redis endpoints. */
  scan: 'SCAN',
  /** Native SERVER protocol word used by fixed Redis endpoints. */
  server: 'SERVER',
  /** Native SET protocol word used by fixed Redis endpoints. */
  set: 'SET',
  /** Native STREAMS protocol word used by fixed Redis endpoints. */
  streams: 'STREAMS',
  /** Native TIME protocol word used by fixed Redis endpoints. */
  time: 'TIME',
  /** Native WATCH protocol word used by fixed Redis endpoints. */
  watch: 'WATCH',
  /** Native WITHSCORES protocol word used by fixed Redis endpoints. */
  withscores: 'WITHSCORES',
  /** Native XACK protocol word used by fixed Redis endpoints. */
  xack: 'XACK',
  /** Native XADD protocol word used by fixed Redis endpoints. */
  xadd: 'XADD',
  /** Native XAUTOCLAIM protocol word used by fixed Redis endpoints. */
  xautoclaim: 'XAUTOCLAIM',
  /** Native XGROUP protocol word used by fixed Redis endpoints. */
  xgroup: 'XGROUP',
  /** Native XRANGE protocol word used by fixed Redis endpoints. */
  xrange: 'XRANGE',
  /** Native XREADGROUP protocol word used by fixed Redis endpoints. */
  xreadgroup: 'XREADGROUP',
  /** Native ZADD protocol word used by fixed Redis endpoints. */
  zadd: 'ZADD',
  /** Native ZRANGE protocol word used by fixed Redis endpoints. */
  zrange: 'ZRANGE',
  /** Native ZRANGEBYLEX protocol word used by fixed Redis endpoints. */
  zrangebylex: 'ZRANGEBYLEX',
  /** Native ZRANK protocol word used by fixed Redis endpoints. */
  zrank: 'ZRANK',
  /** Native ZREM protocol word used by fixed Redis endpoints. */
  zrem: 'ZREM',
  multi: 'MULTI',
  exec: 'EXEC',
  discard: 'DISCARD',
  unwatch: 'UNWATCH'
} as const
/**
 * MULTI acknowledgement words are fixed native protocol replies checked before another command is
 * queued.
 */
export const RedisReply = { ok: 'OK', queued: 'QUEUED' } as const
/** Native subscription callbacks and fixed reply diagnostics share one owner. */
export const RedisText = {
  backend: 'redis',
  failed: 'Redis operation failed',
  decodeFailed: 'Redis reply or persisted value is invalid',
  argument: 'Redis command arguments are invalid',
  transactionFailed: 'Redis transaction failed',
  connectionChanged: 'Redis connection changed before EXEC',
  lockConflict: 'Redis lock is held by another attempt',
  message: 'message',
  error: 'error'
} as const
/** Original SDK aggregate evidence travels with its actual EXEC reply, without a registry. */
export const redisExecCause = Symbol('redis-exec-cause')

/** Backend operations and protocol events have one stable package owner. */
export const RedisOperation = {
  get: 'get',
  set: 'set',
  remove: 'remove',
  has: 'has',
  keys: 'keys',
  clearValues: 'clearValues',
  clearBytes: 'clearBytes',
  clearRecords: 'clearRecords',
  clearAll: 'clearAll',
  getBytes: 'getBytes',
  setBytes: 'setBytes',
  removeBytes: 'removeBytes',
  getRecord: 'getRecord',
  putRecord: 'putRecord',
  deleteRecord: 'deleteRecord',
  getMany: 'getMany',
  setMany: 'setMany',
  removeMany: 'removeMany',
  removeByPrefix: 'removeByPrefix',
  next: 'iterateRecords.next',
  transaction: 'transaction',
  expire: 'ttl.expire',
  remaining: 'ttl.remaining',
  persist: 'ttl.persist',
  increment: 'counter.increment',
  inspectLocks: 'inspectLocks',
  watch: 'watch.next',
  queryDelete: 'query.delete',
  queryUpdate: 'query.update',
  onRedisCommand: 'onRedisCommand',
  onWatchConflict: 'onWatchConflict'
} as const
