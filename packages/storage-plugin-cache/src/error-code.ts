/** Cache orchestration errors have one registered domain independent of their borrowed tiers. */
export const ERROR_SOURCE = 'storage.backend.cache' as const
/** Configuration and callback failures remain distinct from errors owned by borrowed backends. */
export const CacheErrorCode = {
  /**
   * Invalid tier, policy or propagation configuration; correct the configuration before
   * installation.
   */
  tierInvalid: 'CACHE_TIER_INVALID',
  /** The caller's loader or value encoding failed; inspect the original cause and retry explicitly. */
  loadFailed: 'CACHE_LOAD_FAILED',
  /** The caller's embedding function failed; inspect its cause without treating it as a cache miss. */
  embedFailed: 'CACHE_EMBED_FAILED'
} as const
export type ICacheErrorCode = (typeof CacheErrorCode)[keyof typeof CacheErrorCode]
