import { type IOperationContext } from '../context.ts'
import { type IStorageResource } from '../resource.ts'
import { STORAGE_BLOB_METHODS } from '../capability-constants.ts'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.ts'
import { type IBackendKind } from '../capabilities.ts'
import { assertOperationContext } from '../operation-context.ts'
import { assertStringStorageKey } from '../key.ts'
import { StorageContractError, StorageContractErrorCode } from '../errors.ts'
import { StorageContractErrorText } from '../error-text.ts'
import { isUint8Array } from '@migaia/utils/bytes'

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

/** Check the supported options object without touching a body reader or native resource. */
function assertBlobOptions(options: unknown, backend: IBackendKind | undefined): void {
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend },
      StorageContractErrorText.blobArgument
    )
}

/** The existing blob argument identity is shared by pure validation and byte-copy admission. */
export function invalidBlobInput(
  backend: IBackendKind | undefined,
  cause?: unknown
): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend, ...(cause === undefined ? {} : { cause }) },
    StorageContractErrorText.blobArgument
  )
}

/** Validate upload domains without acquiring a reader or allocating detached data. */
export function assertStorageBlobPut(
  key: string,
  body: Uint8Array | ReadableStream<Uint8Array>,
  options: Parameters<IBlobApi['put']>[2],
  backend: IBackendKind | undefined
): void {
  assertStringStorageKey(key, backend)
  assertBlobOptions(options, backend)
  assertOperationContext(options?.ctx)
  if (
    (options?.contentType !== undefined && typeof options.contentType !== 'string') ||
    (options?.ifMatch !== undefined && typeof options.ifMatch !== 'string') ||
    (options?.ifNoneMatch !== undefined && options.ifNoneMatch !== true) ||
    (options?.ifMatch !== undefined && options?.ifNoneMatch !== undefined)
  )
    throw invalidBlobInput(backend)
  assertBlobOptions(options?.metadata, backend)
  for (const value of Object.values(options?.metadata ?? {}))
    if (typeof value !== 'string') throw invalidBlobInput(backend)
  if (
    !isUint8Array(body) &&
    (typeof body !== 'object' ||
      body === null ||
      typeof body.getReader !== 'function' ||
      typeof body.cancel !== 'function' ||
      body.locked !== false)
  )
    throw invalidBlobInput(backend)
}

/** Validate inclusive byte bounds without creating a new range or opening native content. */
export function assertStorageBlobGet(
  key: string,
  options: Parameters<IBlobApi['get']>[1],
  backend: IBackendKind | undefined
): void {
  assertStringStorageKey(key, backend)
  assertBlobOptions(options, backend)
  assertOperationContext(options?.ctx)
  assertBlobOptions(options?.range, backend)
  /** A supplied range must begin at a safe nonnegative byte position. */
  const start = options?.range?.start
  /** An omitted end retains the native open-ended range contract. */
  const end = options?.range?.end
  if (
    options?.range !== undefined &&
    (!Number.isSafeInteger(start) ||
      start! < 0 ||
      (end !== undefined && (!Number.isSafeInteger(end) || end < start!)))
  )
    throw invalidBlobInput(backend)
}

/** Validate the shared prefix/cursor/limit domain without copying its caller options. */
export function assertStorageBlobList(
  options: Parameters<IBlobApi['list']>[0],
  ctx: IOperationContext | undefined,
  backend: IBackendKind | undefined
): void {
  assertBlobOptions(options, backend)
  /** Omission alone selects the existing default prefix. */
  const prefix = options?.prefix === undefined ? '' : options.prefix
  /** The existing default bound is applied only when the caller omits it. */
  const limit = options?.limit === undefined ? 100 : options.limit
  assertOperationContext(ctx)
  if (
    typeof prefix !== 'string' ||
    (options?.after !== undefined && typeof options.after !== 'string') ||
    !Number.isSafeInteger(limit) ||
    limit < 1
  )
    throw invalidBlobInput(backend)
}
