import type { IStorageHookIdentity } from '@migaia/storage-host'
/** Command observation excludes every argument, key and credential. */
export type IRedisCommandHookPayload = IStorageHookIdentity &
  Readonly<{ command: string; elapsedMs: number }>
/** Only actual watched-key count crosses the backend's observation boundary. */
export type IRedisWatchConflictHookPayload = IStorageHookIdentity & Readonly<{ keyCount: number }>
declare module '@migaia/storage-host' {
  /** Native backend events share the original host hook registry. */
  interface IStorageHookMap {
    onRedisCommand: IRedisCommandHookPayload
    onWatchConflict: IRedisWatchConflictHookPayload
  }
}
