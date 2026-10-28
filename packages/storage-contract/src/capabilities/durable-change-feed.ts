import type { IOperationContext } from '../context.ts'
import type { IStorageResource } from '../resource.ts'
import type { IStorageChange } from '../change-feed.ts'
import { STORAGE_DURABLE_CHANGE_METHODS } from '../capability-constants.ts'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.ts'

/** Opaque cursors identify actual retained commits and remain independent from transient sequence. */
export type IDurableStorageChange = IStorageChange & { readonly cursor: string }
/** Native replay is at least once; the caller persists only successfully processed cursors. */
export type IDurableChangeFeedApi = {
  readChanges(
    options?: { readonly after?: string; readonly limit?: number },
    ctx?: IOperationContext
  ): Promise<{ readonly changes: readonly IDurableStorageChange[]; readonly cursor: string }>
  tailChanges(
    options: {
      readonly from: string | 'now'
      readonly onChange: (change: IDurableStorageChange) => void | PromiseLike<void>
      readonly onError?: (error: unknown) => void
    },
    ctx?: IOperationContext
  ): Promise<IStorageResource>
}
/** Durable publication requires a real replay source and never manufactures memory durability. */
export const durableChangeFeed = /* @__PURE__ */ defineStandardStorageCapability<
  IDurableChangeFeedApi,
  'durableChangeFeed'
>('durableChangeFeed', {
  validate: (api) => validateCapabilityMethods(api, STORAGE_DURABLE_CHANGE_METHODS)
})
