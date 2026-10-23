import type { IOperationContext } from '../context.js'
import type { IStorageResource } from '../resource.js'
import { STORAGE_BLOB_METHODS } from '../capability-constants.js'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.js'
import type { IBackendKind } from '../capabilities.js'
import { snapshotOperationContext } from '../operation-context.js'
import { assertStringStorageKey } from '../key.js'
import { StorageContractError, StorageContractErrorCode } from '../errors.js'
import { StorageContractErrorText } from '../error-text.js'
import { createStorageIteratorLifetime } from '../resource.js'
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

/** Return domains derive from the original API so backends do not maintain parallel option types. */
type IBlobPutOptions = NonNullable<Parameters<IBlobApi['put']>[2]>
/** Range snapshots retain the original inclusive-end option contract. */
type IBlobGetOptions = NonNullable<Parameters<IBlobApi['get']>[1]>

/** Capture getter failures through the original contract family without relabeling its own errors. */
function blobInput<T>(backend: IBackendKind | undefined, capture: () => T): T {
  try {
    return capture()
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend, cause },
      StorageContractErrorText.blobArgument
    )
  }
}

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

/**
 * Detach upload bytes and string metadata at admission. Streams remain unconsumed; a backend first
 * checks native conditions and only then takes reader ownership. Getter failures retain cause.
 */
export function snapshotStorageBlobPut(
  key: string,
  body: Uint8Array | ReadableStream<Uint8Array>,
  options: Parameters<IBlobApi['put']>[2],
  backend: IBackendKind | undefined
): Readonly<{
  key: string
  body: Uint8Array | ReadableStream<Uint8Array>
  options: IBlobPutOptions
}> {
  return blobInput(backend, () => {
    assertStringStorageKey(key, backend)
    assertBlobOptions(options, backend)
    /** Public fields are read once before the result can cross an asynchronous boundary. */
    const contentType = options?.contentType
    const inputMetadata = options?.metadata
    const ifMatch = options?.ifMatch
    const ifNoneMatch = options?.ifNoneMatch
    const ctx = snapshotOperationContext(options?.ctx)
    if (
      (contentType !== undefined && typeof contentType !== 'string') ||
      (ifMatch !== undefined && typeof ifMatch !== 'string') ||
      (ifNoneMatch !== undefined && ifNoneMatch !== true) ||
      (ifMatch !== undefined && ifNoneMatch !== undefined)
    )
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend },
        StorageContractErrorText.blobArgument
      )
    assertBlobOptions(inputMetadata, backend)
    /** Object.fromEntries preserves every own string key, including a literal **proto** field. */
    const metadata = Object.freeze(
      Object.fromEntries(
        Object.keys(inputMetadata ?? {}).map((name) => {
          const value = inputMetadata![name]
          if (typeof value !== 'string')
            throw new StorageContractError(
              StorageContractErrorCode.invalidArgument,
              { backend },
              StorageContractErrorText.blobArgument
            )
          return [name, value]
        })
      )
    )
    /** Structural WHATWG admission also accepts a genuine stream from another realm. */
    const capturedBody = isUint8Array(body) ? new Uint8Array(body) : body
    if (
      !isUint8Array(capturedBody) &&
      (typeof capturedBody !== 'object' ||
        capturedBody === null ||
        typeof capturedBody.getReader !== 'function' ||
        typeof capturedBody.cancel !== 'function' ||
        capturedBody.locked !== false)
    )
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend },
        StorageContractErrorText.blobArgument
      )
    return Object.freeze({
      key,
      body: capturedBody,
      options: Object.freeze({ contentType, metadata, ifMatch, ifNoneMatch, ctx })
    })
  })
}

/** Snapshot inclusive safe-integer bounds and the original context before opening native content. */
export function snapshotStorageBlobGet(
  key: string,
  options: Parameters<IBlobApi['get']>[1],
  backend: IBackendKind | undefined
): Readonly<{ key: string; options: IBlobGetOptions }> {
  return blobInput(backend, () => {
    assertStringStorageKey(key, backend)
    assertBlobOptions(options, backend)
    const input = options?.range
    const ctx = snapshotOperationContext(options?.ctx)
    assertBlobOptions(input, backend)
    const start = input?.start
    const end = input?.end
    if (
      input !== undefined &&
      (!Number.isSafeInteger(start) ||
        start! < 0 ||
        (end !== undefined && (!Number.isSafeInteger(end) || end < start!)))
    )
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend },
        StorageContractErrorText.blobArgument
      )
    const range = input === undefined ? undefined : Object.freeze({ start: start!, end })
    return Object.freeze({ key, options: Object.freeze({ range, ctx }) })
  })
}

/** Capture the shared string prefix, opaque cursor and positive bound; omission uses limit 100. */
export function snapshotStorageBlobList(
  options: Parameters<IBlobApi['list']>[0],
  ctx: IOperationContext | undefined,
  backend: IBackendKind | undefined
): Readonly<{
  prefix: string
  after: string | undefined
  limit: number
  ctx: IOperationContext | undefined
}> {
  return blobInput(backend, () => {
    assertBlobOptions(options, backend)
    const inputPrefix = options?.prefix
    const prefix = inputPrefix === undefined ? '' : inputPrefix
    const after = options?.after
    const inputLimit = options?.limit
    const limit = inputLimit === undefined ? 100 : inputLimit
    const context = snapshotOperationContext(ctx)
    if (
      typeof prefix !== 'string' ||
      (after !== undefined && typeof after !== 'string') ||
      !Number.isSafeInteger(limit) ||
      limit < 1
    )
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend },
        StorageContractErrorText.blobArgument
      )
    return Object.freeze({ prefix, after, limit, ctx: context })
  })
}

/**
 * Attach the blob's single consumption right to the existing iterator resource owner. Disposal
 * cancels an outstanding native read before that owner waits for accepted reads to drain. Main and
 * symbolic cleanup keep their original distinct cached Promise and error policies.
 */
export function createStorageBlobObject(
  info: IBlobInfo,
  source: ReadableStream<Uint8Array>,
  options: {
    readonly close: () => void | PromiseLike<void>
    readonly report: (error: unknown) => void | PromiseLike<void>
    readonly backend?: IBackendKind
    readonly onSettled?: () => void
    readonly normalizeFailure?: (error: unknown) => unknown
  }
): IBlobObject {
  /** The backend already captured one native data/metadata snapshot; detach its public metadata. */
  const capturedInfo = Object.freeze({ ...info, metadata: Object.freeze({ ...info.metadata }) })
  /** Native backend classification remains with its owner while resource state stays shared. */
  const normalize = options.normalizeFailure ?? ((error: unknown): unknown => error)
  /** One native reader exists only after a caller claims stream or bytes. */
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  /** Stream and bytes share exactly one successful content claim. */
  let consumed = false
  /** Cancellation starts synchronously at disposal and settles within original cleanup. */
  let cancellation: Promise<void> | undefined
  /** The original resource helper owns accepted reads, EOF, cleanup caching and symbolic reporting. */
  const lifetime = createStorageIteratorLifetime<Uint8Array>({
    close: async () => {
      /** Native cancellation is primary; a later release failure is reported without replacing it. */
      let primary: unknown
      /** A rejected undefined value is still a real cancellation failure. */
      let failed = false
      try {
        await cancellation
      } catch (error) {
        failed = true
        primary = normalize(error)
      }
      try {
        reader?.releaseLock()
      } catch (error) {
        if (failed) options.report(normalize(error))
        else {
          failed = true
          primary = normalize(error)
        }
      }
      try {
        await options.close()
      } catch (error) {
        if (failed) options.report(normalize(error))
        else {
          failed = true
          primary = normalize(error)
        }
      }
      if (failed) throw primary
    },
    report: options.report,
    onSettled: options.onSettled
  })
  /** Cancel first so a blocked read can settle before the original resource drain waits for it. */
  const beginCancel = (): void => {
    if (lifetime.isClosing()) return
    cancellation = reader ? reader.cancel() : source.cancel()
    void cancellation.catch(() => undefined)
  }
  /** Claim one native stream without prefetching or introducing a per-chunk operation pipeline. */
  const stream = (): ReadableStream<Uint8Array> => {
    if (consumed || lifetime.isClosing())
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend: options.backend },
        StorageContractErrorText.blobConsumed
      )
    consumed = true
    reader = source.getReader()
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const item = await lifetime.advance(async () => {
              const next = await reader!.read().catch((error: unknown) => {
                throw normalize(error)
              })
              return next.done
                ? { done: true, value: undefined }
                : { done: false, value: next.value }
            })
            if (item.done) controller.close()
            else controller.enqueue(item.value)
          } catch (error) {
            controller.error(error)
            try {
              await lifetime.dispose()
            } catch (cleanup) {
              options.report(cleanup)
            }
          }
        },
        cancel() {
          beginCancel()
          return lifetime.dispose()
        }
      },
      { highWaterMark: 0 }
    )
  }
  return {
    info: capturedInfo,
    stream,
    async bytes() {
      const input = stream().getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          const next = await input.read()
          if (next.done) break
          chunks.push(next.value)
          size += next.value.byteLength
        }
      } finally {
        input.releaseLock()
      }
      const result = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }
      return result
    },
    dispose: () => {
      beginCancel()
      return lifetime.dispose()
    },
    [Symbol.asyncDispose]: () => {
      beginCancel()
      return lifetime.symbolic()
    }
  }
}
