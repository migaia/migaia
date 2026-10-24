/** Tier writes either finish before return or enter the cache's explicitly configured pending table. */
export const CacheWriteMode = { through: 'through', back: 'back' } as const
export type CacheWriteMode = keyof typeof CacheWriteMode
/** Stable cache identities and errors belong to the orchestration package, not any borrowed tier. */
export const CacheText = {
  backend: 'cache',
  argument: 'Invalid cache input.',
  loadFailed: 'Cache loader or value encoding failed.',
  embedFailed: 'Cache embedding failed.',
  tierInvalid: (tier?: number) =>
    `Cache tier ${tier === undefined ? 'configuration' : tier} is invalid.`,
  missingCapability: (tier: number, capability: string) =>
    `Cache tier ${tier} requires ${capability}.`
} as const
