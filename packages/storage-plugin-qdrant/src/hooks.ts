import type { IStorageHttpHookPayload } from '@migaia/storage-host'
declare module '@migaia/storage-host' {
  /** Interface semantics augment the original host's sole event map. */
  interface IStorageHookMap {
    onHttpRequest: IStorageHttpHookPayload
  }
}
/** The shared hook payload contains only sanitized route and aggregate request facts. */
export type IQdrantHttpHookPayload = IStorageHttpHookPayload
