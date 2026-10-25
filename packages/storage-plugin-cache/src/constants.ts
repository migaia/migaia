/** Tier writes either finish before return or enter the cache's explicitly configured pending table. */
export const CacheWriteMode = { through: 'through', back: 'back' } as const
export type CacheWriteMode = keyof typeof CacheWriteMode
/** Stable cache identities and errors belong to the orchestration package, not any borrowed tier. */
export const CacheText = {
  backend: 'cache',
  lockCapability: 'transactions and key locks',
  prefixCountCapability: 'exact logical prefix deletion counts',
  tagCapability: 'records, ttl and prefix iteration',
  changeFeed: 'subscribeChanges',
  normal: 'default',
  refresh: 'refresh',
  bypass: 'bypass',
  string: 's',
  value: 'value',
  all: 'all',
  cursor: '$cache.cursor',
  now: 'now',
  argument: 'Invalid cache input.',
  loadFailed: 'Cache loader or value encoding failed.',
  embedFailed: 'Cache embedding failed.',
  tierInvalid: (tier?: number) =>
    `Cache tier ${tier === undefined ? 'configuration' : tier} is invalid.`,
  missingCapability: (tier: number, capability: string) =>
    `Cache tier ${tier} requires ${capability}.`
} as const

/** Stable operation labels are shared by host pipelines, tier diagnostics and native ports. */
export const CacheOperation = {
  get: 'get',
  has: 'has',
  set: 'set',
  remove: 'remove',
  keys: 'keys',
  clearValues: 'clearValues',
  clearAll: 'clearAll',
  getMany: 'getMany',
  setMany: 'setMany',
  removeMany: 'removeMany',
  removeByPrefix: 'removeByPrefix',
  getOrLoad: 'getOrLoad',
  getOrLoadMany: 'getOrLoadMany',
  peek: 'peek',
  invalidate: 'invalidate',
  flush: 'flush',
  sweepOffload: 'sweepOffload',
  decode: 'decode',
  tags: 'tags',
  iterateRecords: 'iterateRecords',
  putRecord: 'putRecord'
} as const
/** Cache event names belong to the same original host registry as all backend hooks. */
export const CacheHook = {
  hit: 'onCacheHit',
  miss: 'onCacheMiss',
  load: 'onCacheLoad',
  invalidate: 'onCacheInvalidate',
  tierError: 'onCacheTierError',
  writeBackDropped: 'onCacheWriteBackDropped'
} as const
