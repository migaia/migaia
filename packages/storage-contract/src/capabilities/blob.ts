import type { IOperationContext } from '../context.js'
import type { IStorageResource, IStorageIterator } from '../resource.js'
import { STORAGE_BLOB_METHODS } from '../capability-constants.js'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.js'
import type { IBackendKind } from '../capabilities.js'
import { snapshotOperationContext, assertOperationContext } from '../operation-context.js'
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
function invalidBlobInput(
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
/**
 * Copies bytes retained by an accepted upload; native detached-buffer failures keep argument
 * identity.
 */
function snapshotBlobBytes(body: Uint8Array, backend: IBackendKind | undefined): Uint8Array {
  try {
    return new Uint8Array(body)
  } catch (cause) {
    throw invalidBlobInput(backend, cause)
  }
}
/** Capture mutable bytes/metadata/options before queued admission and native condition awaits. */
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
  assertStorageBlobPut(key, body, options, backend)
  return {
    key,
    body: isUint8Array(body) ? snapshotBlobBytes(body, backend) : body,
    options: {
      contentType: options?.contentType,
      metadata: Object.fromEntries(Object.entries(options?.metadata ?? {})),
      ifMatch: options?.ifMatch,
      ifNoneMatch: options?.ifNoneMatch,
      ctx: snapshotOperationContext(options?.ctx)
    }
  }
}
/** Range and context scalars must survive the native content-open await. */
export function snapshotStorageBlobGet(
  key: string,
  options: Parameters<IBlobApi['get']>[1],
  backend: IBackendKind | undefined
): Readonly<{ key: string; options: IBlobGetOptions }> {
  assertStorageBlobGet(key, options, backend)
  return {
    key,
    options: {
      range:
        options?.range === undefined
          ? undefined
          : { start: options.range.start, end: options.range.end },
      ctx: snapshotOperationContext(options?.ctx)
    }
  }
}
/** List scalars must survive native pagination without rereading caller options. */
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
  assertStorageBlobList(options, ctx, backend)
  return {
    prefix: options?.prefix === undefined ? '' : options.prefix,
    after: options?.after,
    limit: options?.limit === undefined ? 100 : options.limit,
    ctx: snapshotOperationContext(ctx)
  }
}
/** Backend failure classification is borrowed; this helper adds no error or lifecycle owner. */
type IBlobReaderOptions = {
  readonly report: (error: unknown) => void | PromiseLike<void>
  readonly backend?: IBackendKind
  readonly normalizeFailure?: (error: unknown) => unknown
}
/** Download cleanup also closes the backend's original content resource after releasing its reader. */
type IBlobObjectOptions = IBlobReaderOptions & {
  readonly close: () => void | PromiseLike<void>
  readonly onSettled?: () => void
}
/** Cleanup borrows the accepted native reader and original failure/report callbacks. */
type IBlobCleanupContext = {
  readonly reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  readonly cancellation: Promise<void> | undefined
  readonly normalize: (error: unknown) => unknown
  readonly report: (error: unknown) => void | PromiseLike<void>
  readonly close?: () => void | PromiseLike<void>
}
/** Cancellation stays primary; later native release/close failures use the original report channel. */
async function closeBlobReader(context: IBlobCleanupContext): Promise<void> {
  /** Even rejection with undefined remains a real primary failure. */
  let failed = false
  /** The first actual cleanup error retains its original identity or backend classification. */
  let primary: unknown
  try {
    await context.cancellation
  } catch (error) {
    failed = true
    primary = context.normalize(error)
  }
  try {
    context.reader?.releaseLock()
  } catch (error) {
    if (failed) context.report(context.normalize(error))
    else {
      failed = true
      primary = context.normalize(error)
    }
  }
  if (context.close !== undefined)
    try {
      await context.close()
    } catch (error) {
      if (failed) context.report(context.normalize(error))
      else {
        failed = true
        primary = context.normalize(error)
      }
    }
  if (failed) throw primary
}
/** Byte input uses the native stream protocol without prefetching or another upload scheduler. */
function blobByteSource(body: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body)
      controller.close()
    }
  })
}
/** One upload reader borrows the original lifetime for accepted advances, EOF and cached disposal. */
class StorageBlobBodyReader implements IStorageIterator<Uint8Array> {
  /** The sink owns this single native reader after write-condition admission. */
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>
  /** Classification and reporting remain with the selected backend. */
  readonly #options: IBlobReaderOptions
  /** Capture the original opaque normalizer while invoking it as a plain callback. */
  readonly #normalizer: ((error: unknown) => unknown) | undefined
  /** The original resource helper owns draining and main/symbolic Promise caching. */
  readonly #lifetime: ReturnType<typeof createStorageIteratorLifetime<Uint8Array>>
  /** A settled EOF or failed native read must never be cancelled again. */
  #ended = false
  /** Early cancellation starts synchronously and settles during the original lifetime cleanup. */
  #cancellation: Promise<void> | undefined
  /** Acquires only the native reader; no read starts until the sink asks for next. */
  constructor(body: Uint8Array | ReadableStream<Uint8Array>, options: IBlobReaderOptions) {
    this.#options = options
    this.#normalizer = options.normalizeFailure
    /** Byte callers share the same native reader protocol as streaming callers. */
    const source = isUint8Array(body) ? blobByteSource(body) : body
    try {
      this.#reader = source.getReader()
    } catch (error) {
      throw this.#normalize(error)
    }
    this.#lifetime = createStorageIteratorLifetime<Uint8Array>({
      close: () => this.#close(),
      report: options.report
    })
  }
  /** Preserve the original normalizer's plain invocation receiver. */
  #normalize(error: unknown): unknown {
    /** Opaque callbacks keep their original call convention. */ const normalize = this.#normalizer
    return normalize === undefined ? error : normalize(error)
  }
  /** Cleanup observes the cancellation already started by return/dispose. */
  #close(): Promise<void> {
    return closeBlobReader({
      reader: this.#reader,
      cancellation: this.#cancellation,
      normalize: (error) => this.#normalize(error),
      report: (error) => this.#options.report(error)
    })
  }
  /** Seals the same native reader synchronously so a blocked accepted read can drain. */
  #beginCancel(reason?: unknown): void {
    if (this.#ended || this.#lifetime.isClosing()) return
    try {
      this.#cancellation = this.#reader.cancel(reason)
    } catch (error) {
      this.#cancellation = Promise.reject(error)
    }
    void this.#cancellation.catch(() => undefined)
  }
  /** Native reads retain EOF/failure classification and detach chunks before sink awaits. */
  async #advance(): Promise<IteratorResult<Uint8Array>> {
    /** Even rejection with undefined marks this native reader terminal. */
    let next: ReadableStreamReadResult<Uint8Array>
    try {
      next = await this.#reader.read()
    } catch (error) {
      this.#ended = true
      throw this.#normalize(error)
    }
    if (next.done) {
      this.#ended = true
      return { done: true, value: undefined }
    }
    if (!isUint8Array(next.value)) throw invalidBlobInput(this.#options.backend)
    return { done: false, value: snapshotBlobBytes(next.value, this.#options.backend) }
  }
  /** Every pull is accepted by the existing iterator lifetime. */
  readonly next = (): Promise<IteratorResult<Uint8Array>> =>
    this.#lifetime.isClosing()
      ? this.#lifetime.returned()
      : this.#lifetime.advance(() => this.#advance())
  /** Return preserves its own cached Promise and original cancellation reason. */
  readonly return = (reason?: unknown): Promise<IteratorResult<Uint8Array>> => {
    this.#beginCancel(reason)
    return this.#lifetime.returned(reason)
  }
  /** Main disposal retains the original cached cleanup rejection. */
  readonly dispose = (): Promise<void> => {
    this.#beginCancel()
    return this.#lifetime.dispose()
  }
  /** Symbolic disposal uses the same cleanup and original separate reporting Promise. */
  readonly [Symbol.asyncDispose] = (): Promise<void> => {
    this.#beginCancel()
    return this.#lifetime.symbolic()
  };
  /** The native upload sink consumes this same iterator without another wrapper. */
  [Symbol.asyncIterator](): IStorageIterator<Uint8Array> {
    return this
  }
}
/** Creates the upload owner only after a backend has checked its native write conditions. */
export function createStorageBlobBodyReader(
  body: Uint8Array | ReadableStream<Uint8Array>,
  options: IBlobReaderOptions
): IStorageIterator<Uint8Array> {
  return new StorageBlobBodyReader(body, options)
}
/** One download owner shares a single content claim and the original native cleanup lifetime. */
class StorageBlobObject implements IBlobObject {
  /** Native metadata already represents the backend snapshot and needs no defensive second copy. */
  readonly info: IBlobInfo
  /** The backend's original source is cancelled if content was never claimed. */
  readonly #source: ReadableStream<Uint8Array>
  /** Native closing, reporting and failure classification remain backend owned. */
  readonly #options: IBlobObjectOptions
  /** Opaque normalizers retain their original plain invocation convention. */
  readonly #normalizer: ((error: unknown) => unknown) | undefined
  /** The existing helper owns advance/drain/cleanup caching and symbolic reporting. */
  readonly #lifetime: ReturnType<typeof createStorageIteratorLifetime<Uint8Array>>
  /** Exactly one native reader is acquired by the sole successful content claim. */
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  /** Stream and bytes share this one content right. */
  #consumed = false
  /** Native cancellation starts before the lifetime waits for accepted reads. */
  #cancellation: Promise<void> | undefined
  /** Construction borrows the original source and metadata without consuming content. */
  constructor(info: IBlobInfo, source: ReadableStream<Uint8Array>, options: IBlobObjectOptions) {
    this.info = info
    this.#source = source
    this.#options = options
    this.#normalizer = options.normalizeFailure
    this.#lifetime = createStorageIteratorLifetime<Uint8Array>({
      close: () => this.#close(),
      report: options.report,
      onSettled: options.onSettled
    })
  }
  /** Preserve the original failure callback's plain receiver and identity. */
  #normalize(error: unknown): unknown {
    /** The original callback is invoked without an object receiver. */ const normalize =
      this.#normalizer
    return normalize === undefined ? error : normalize(error)
  }
  /** Cancellation is primary; native release and backend close follow in their original order. */
  #close(): Promise<void> {
    return closeBlobReader({
      reader: this.#reader,
      cancellation: this.#cancellation,
      normalize: (error) => this.#normalize(error),
      report: (error) => this.#options.report(error),
      close: () => this.#options.close()
    })
  }
  /** Cancellation wakes outstanding reads before accepted work begins draining. */
  #beginCancel(): void {
    if (this.#lifetime.isClosing()) return
    this.#cancellation = this.#reader ? this.#reader.cancel() : this.#source.cancel()
    void this.#cancellation.catch(() => undefined)
  }
  /** Claiming content grants no prefetch and no per-chunk operation pipeline. */
  readonly stream = (): ReadableStream<Uint8Array> => {
    if (this.#consumed || this.#lifetime.isClosing())
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend: this.#options.backend },
        StorageContractErrorText.blobConsumed
      )
    this.#consumed = true
    this.#reader = this.#source.getReader()
    return new ReadableStream<Uint8Array>(
      { pull: (controller) => this.#pull(controller), cancel: () => this.dispose() },
      { highWaterMark: 0 }
    )
  }
  /** Each native read stays inside the original accepted lifetime advance. */
  async #advance(): Promise<IteratorResult<Uint8Array>> {
    /** Native read failures retain the backend classification before reaching the resource owner. */
    const next = await this.#reader!.read().catch((error: unknown) => {
      throw this.#normalize(error)
    })
    return next.done ? { done: true, value: undefined } : { done: false, value: next.value }
  }
  /** Stream errors report a later cleanup failure without replacing the original read error. */
  async #pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    try {
      /** The same native reader and resource owner serve every pull. */ const item =
        await this.#lifetime.advance(() => this.#advance())
      if (item.done) controller.close()
      else controller.enqueue(item.value)
    } catch (error) {
      controller.error(error)
      try {
        await this.#lifetime.dispose()
      } catch (cleanup) {
        this.#options.report(cleanup)
      }
    }
  }
  /** Bytes consumes that same sole stream and releases its wrapper reader after settlement. */
  readonly bytes = async (): Promise<Uint8Array> => {
    /** Claiming the original stream enforces the same single-use content right. */
    const input = this.stream().getReader()
    /** Only requested content is accumulated for this explicit all-bytes terminal. */
    const chunks: Uint8Array[] = []
    /** The total allocates exactly one joined result after native EOF. */
    let size = 0
    try {
      for (;;) {
        /** A native chunk is retained only for this caller-requested byte result. */ const next =
          await input.read()
        if (next.done) break
        chunks.push(next.value)
        size += next.value.byteLength
      }
    } finally {
      input.releaseLock()
    }
    /** The returned byte result owns its contiguous storage. */
    const result = new Uint8Array(size)
    /** Joining preserves source order without another copy of retained chunks. */
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }
  /** Main disposal retains the original cached rejection. */
  readonly dispose = (): Promise<void> => {
    this.#beginCancel()
    return this.#lifetime.dispose()
  }
  /** Symbolic disposal shares cleanup and preserves its distinct cached reporting Promise. */
  readonly [Symbol.asyncDispose] = (): Promise<void> => {
    this.#beginCancel()
    return this.#lifetime.symbolic()
  }
}
/** Attaches native content to its single resource owner without consuming or freezing metadata. */
export function createStorageBlobObject(
  info: IBlobInfo,
  source: ReadableStream<Uint8Array>,
  options: IBlobObjectOptions
): IBlobObject {
  return new StorageBlobObject(info, source, options)
}
