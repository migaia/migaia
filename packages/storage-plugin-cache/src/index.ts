export { CacheWriteMode } from './constants.js'
export { cacheBackendKind } from './kind.js'
export { cacheKey } from './key.js'
export type {
  ICacheOptions,
  ICacheTierOptions,
  ICacheCallOptions,
  ICacheEntryInfo,
  ICacheLoader,
  ICacheBatchLoader,
  ICacheStats,
  ICacheStore
} from './types.js'
import './hooks.js'
export type { ICacheTierHookPayload } from './hooks.js'

export { cachePlugin } from './plugin.js'
