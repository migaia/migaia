export { CacheWriteMode } from './constants.ts'
export { cacheBackendKind } from './kind.ts'
export { cacheKey } from './key.ts'
export type {
  ICacheOptions,
  ICacheTierOptions,
  ICacheCallOptions,
  ICacheEntryInfo,
  ICacheLoader,
  ICacheBatchLoader,
  ICacheStats,
  ICacheStore
} from './types.ts'
import './hooks.ts'
export type { ICacheTierHookPayload } from './hooks.ts'

export { cachePlugin } from './plugin.ts'
