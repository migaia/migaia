import type { IOperationContext } from '../context.js'
import type { IStorageResource } from '../resource.js'
import { STORAGE_BLOB_METHODS } from '../capability-constants.js'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.js'

/** Immutable object metadata describes the snapshot returned by the actual backend. */
export type IBlobInfo = {
  readonly key: string
  readonly size: number
  readonly etag: string
  readonly contentType?: string
  readonly metadata: Readonly<Record<string, string>>
  readonly updatedAt: number
}
/** Stream and bytes share one consumption right and the original resource's disposal lifetime. */
export type IBlobObject = IStorageResource & {
  readonly info: IBlobInfo
  stream(): ReadableStream<Uint8Array>
  bytes(): Promise<Uint8Array>
}
/**
 * Objects own no KV facade or transaction projection; conditions fail through native write
 * conflict.
 */
export type IBlobApi = {
  put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    options?: {
      readonly contentType?: string
      readonly metadata?: Readonly<Record<string, string>>
      readonly ifMatch?: string
      readonly ifNoneMatch?: true
      readonly ctx?: IOperationContext
    }
  ): Promise<IBlobInfo>
  get(
    key: string,
    options?: {
      readonly range?: { readonly start: number; readonly end?: number }
      readonly ctx?: IOperationContext
    }
  ): Promise<IBlobObject | undefined>
  head(key: string, ctx?: IOperationContext): Promise<IBlobInfo | undefined>
  remove(key: string, ctx?: IOperationContext): Promise<boolean>
  list(
    options?: { readonly prefix?: string; readonly after?: string; readonly limit?: number },
    ctx?: IOperationContext
  ): Promise<{ readonly items: readonly IBlobInfo[]; readonly next?: string }>
  removeByPrefix(prefix: string, ctx?: IOperationContext): Promise<number>
}
/** The authentic object token publishes the exact native API without claiming KV or transactions. */
export const blob = /* @__PURE__ */ defineStandardStorageCapability<IBlobApi, 'blob'>('blob', {
  validate: (api) => validateCapabilityMethods(api, STORAGE_BLOB_METHODS)
})
