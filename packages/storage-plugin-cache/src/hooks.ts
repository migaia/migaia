import type { IStorageHookIdentity } from '@migaia/storage-host'

/** Cache observations carry counts and identities without retaining application keys or values. */
export type ICacheTierHookPayload = IStorageHookIdentity & Readonly<{ tier: number }>

declare module '@migaia/storage-host' {
  /** All cache hooks extend the host's original observation registry. */
  interface IStorageHookMap {
    onCacheHit: ICacheTierHookPayload & Readonly<{ stale: boolean; negative: boolean }>
    onCacheMiss: ICacheTierHookPayload
    onCacheLoad: IStorageHookIdentity & Readonly<{ elapsedMs: number; found: boolean }>
    onCacheInvalidate: IStorageHookIdentity & Readonly<{ tiers: number; prefix: boolean }>
    onCacheTierError: ICacheTierHookPayload & Readonly<{ operation: string; code?: string }>
    onCacheWriteBackDropped: ICacheTierHookPayload & Readonly<{ count: number }>
  }
}
