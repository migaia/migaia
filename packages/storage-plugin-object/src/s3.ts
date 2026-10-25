import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  type S3ClientConfig,
  type HeadObjectCommandOutput,
  type GetObjectCommandOutput,
  type ListObjectsV2CommandOutput,
  type PutObjectCommandOutput
} from '@aws-sdk/client-s3'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IBlobInfo,
  type IOperationContext
} from '@migaia/storage-contract'
import { isUint8Array } from '@migaia/utils/bytes'
import { defineObjectDriver } from './driver.js'
import { ObjectDriverKind, ObjectNames } from './constants.js'
import { ObjectErrorCode } from './error-code.js'
import { ObjectErrorText } from './error-text.js'
import { invalidArgument, normalizeObjectError, objectError } from './errors.js'
import { createObjectSender } from './s3/send.js'
import { responseInfo, responseStatus } from './s3/response.js'
import { uploadMultipart } from './s3/multipart.js'
import { assertS3ObjectHeaders } from './s3/options.js'
import type { IObjectDriver, IObjectNative } from './types.js'
/** Injected clients are borrowed; a configured client belongs exclusively to this installation. */
export type IS3ObjectDriverOptions = (
  | { readonly client: S3Client; readonly config?: never }
  | { readonly client?: never; readonly config: S3ClientConfig }
) & {
  readonly bucket: string
  readonly prefix?: string
  readonly multipartThresholdBytes?: number
  readonly partBytes?: number
  readonly partConcurrency?: number
}
/** Capture options because lazy installation must retain the selected bucket and upload limits. */
export function s3ObjectDriver(options: IS3ObjectDriverOptions): IObjectDriver {
  const supplied = {
    client: options?.client,
    config: options?.config,
    bucket: options?.bucket,
    prefix: options?.prefix,
    threshold: options?.multipartThresholdBytes,
    partBytes: options?.partBytes,
    concurrency: options?.partConcurrency
  }
  /** Only omission applies defaults; null and invalid native descriptors are rejected. */
  const captured = {
    ...supplied,
    prefix: supplied.prefix === undefined ? '' : supplied.prefix,
    threshold:
      supplied.threshold === undefined ? ObjectNames.defaultThresholdBytes : supplied.threshold,
    partBytes: supplied.partBytes === undefined ? ObjectNames.defaultPartBytes : supplied.partBytes,
    concurrency:
      supplied.concurrency === undefined ? ObjectNames.defaultPartConcurrency : supplied.concurrency
  }
  if (
    (captured.client !== undefined &&
      (typeof captured.client !== 'object' ||
        captured.client === null ||
        typeof captured.client.send !== 'function')) ||
    (captured.config !== undefined &&
      (typeof captured.config !== 'object' ||
        captured.config === null ||
        Array.isArray(captured.config))) ||
    (captured.client === undefined) === (captured.config === undefined) ||
    typeof captured.bucket !== 'string' ||
    captured.bucket.length === 0 ||
    typeof captured.prefix !== 'string' ||
    !Number.isSafeInteger(captured.threshold) ||
    captured.threshold < 1 ||
    !Number.isSafeInteger(captured.partBytes) ||
    captured.partBytes < ObjectNames.minimumPartBytes ||
    !Number.isSafeInteger(captured.concurrency) ||
    captured.concurrency < 1
  )
    throw invalidArgument()
  return defineObjectDriver(
    ObjectDriverKind.s3,
    async ({ report }) => new S3ObjectNative(captured, report)
  )
}

/**
 * Lazy installation options stay stable while this driver owns its client and conditional-write
 * probe.
 */
type IS3CapturedOptions = {
  client: S3Client | undefined
  config: S3ClientConfig | undefined
  bucket: string
  prefix: string
  threshold: number
  partBytes: number
  concurrency: number
}

/** One S3 installation owns exactly one client and the original native operation methods. */
class S3ObjectNative implements IObjectNative {
  /** Driver identity selects S3 feature support. */
  readonly kind = ObjectDriverKind.s3
  /** Caller-supplied clients remain borrowed; configured clients are disposed by this owner. */
  readonly client: S3Client
  /** Lazy options select the same bucket and upload limits throughout installation. */
  readonly #options: IS3CapturedOptions
  /** SDK calls preserve the original command retry and failure classification. */
  readonly #send: ReturnType<typeof createObjectSender>
  /** Cleanup failures use the existing host report channel. */
  readonly #report: (error: unknown) => void
  /** Native probing alone grants conditional-write support. */
  #conditional = false
  /** Repeated disposal shares the original cleanup promise. */
  #primary: Promise<void> | undefined
  /** Symbol cleanup reports once without replacing ordinary disposal's promise. */
  #symbolic: Promise<void> | undefined
  /** Client construction stays inside the original install window. */
  constructor(options: IS3CapturedOptions, report: (error: unknown) => void) {
    this.#options = options
    this.#report = report
    this.client = options.client ?? new S3Client(options.config!)
    this.#send = createObjectSender(this.client)
  }
  /** Native feature addresses use the installation's bucket and prefix. */
  address = (key: string) => ({ bucket: this.#options.bucket, key: this.#options.prefix + key })
  /** Release only a client constructed by this installation. */
  dispose = (): Promise<void> =>
    (this.#primary ??= Promise.resolve().then(() => {
      if (!this.#options.client) this.client.destroy()
    }))
  /** Missing response metadata is corruption; only an unconditional 404 is absence. */
  head = async (
    key: string,
    logicalKey: string,
    ctx?: IOperationContext,
    ifMatch?: string
  ): Promise<IBlobInfo | undefined> => {
    try {
      return responseInfo(
        logicalKey,
        await this.#send<HeadObjectCommandOutput>(
          new HeadObjectCommand({
            Bucket: this.#options.bucket,
            Key: this.#options.prefix + key,
            IfMatch: ifMatch
          }),
          ctx
        )
      )
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      if (ifMatch === undefined && responseStatus(cause) === 404) return undefined
      throw error
    }
  }

  /** Execute the original detect operation using this installation's native state. */
  detect: IObjectNative['detect'] = async (signal) => {
    await this.#send(new HeadBucketCommand({ Bucket: this.#options.bucket }), { signal })
    const probe = this.#options.prefix + ObjectNames.probe + crypto.randomUUID()
    let attempted = false
    let failure: unknown
    this.#conditional = false
    try {
      attempted = true
      const first = await this.#send<PutObjectCommandOutput>(
        new PutObjectCommand({
          Bucket: this.#options.bucket,
          Key: probe,
          Body: new Uint8Array([1]),
          IfNoneMatch: '*'
        }),
        { signal },
        true
      )
      if (typeof first.ETag !== 'string') throw objectError(ObjectErrorCode.dataInvalid)
      for (const condition of [{ IfNoneMatch: '*' }, { IfMatch: first.ETag + '-different' }]) {
        let rejected = false
        try {
          await this.#send(
            new PutObjectCommand({
              Bucket: this.#options.bucket,
              Key: probe,
              Body: new Uint8Array([2]),
              ...condition
            }),
            { signal },
            true
          )
        } catch (error) {
          const original = error instanceof Error ? error.cause : undefined
          if (responseStatus(original) !== 412) throw error
          rejected = true
        }
        if (!rejected)
          throw new StorageContractError(
            StorageContractErrorCode.unsupported,
            { backend: ObjectNames.backend },
            ObjectErrorText.conditional
          )
      }
      this.#conditional = true
    } catch (error) {
      failure = error
      this.#report(error)
    } finally {
      if (attempted)
        try {
          await this.#send(
            new DeleteObjectCommand({ Bucket: this.#options.bucket, Key: probe }),
            undefined,
            true
          )
        } catch (error) {
          this.#conditional = false
          const cleanup = new Error(ObjectErrorText.probeCleanup(probe), {
            cause:
              failure === undefined
                ? error
                : new AggregateError([failure, error], ObjectErrorText.failed)
          })
          this.#report(objectError(ObjectErrorCode.failed, cleanup))
        }
    }
  }

  /** Execute the original put operation using this installation's native state. */
  put: IObjectNative['put'] = async (key, logicalKey, body, options) => {
    const hasCondition = options.ifMatch !== undefined || options.ifNoneMatch === true
    if (hasCondition && !this.#conditional)
      throw new StorageContractError(
        StorageContractErrorCode.unsupported,
        { backend: ObjectNames.backend },
        ObjectErrorText.conditional
      )
    assertS3ObjectHeaders(options)
    let etag: string
    if (!isUint8Array(body) || body.byteLength >= this.#options.threshold)
      etag = await uploadMultipart(
        this.#send,
        this.#options.bucket,
        this.#options.prefix + key,
        body,
        options,
        this.#options.partBytes,
        this.#options.concurrency,
        this.#report
      )
    else {
      const result = await this.#send<PutObjectCommandOutput>(
        new PutObjectCommand({
          Bucket: this.#options.bucket,
          Key: this.#options.prefix + key,
          Body: body,
          ContentType: options.contentType,
          Metadata: options.metadata,
          IfMatch: options.ifMatch,
          IfNoneMatch: options.ifNoneMatch ? '*' : undefined
        }),
        options.ctx,
        true,
        true,
        hasCondition
      )
      etag = result.ETag!
    }
    try {
      if (typeof etag !== 'string') throw objectError(ObjectErrorCode.dataInvalid)
      const info = await this.head(key, logicalKey, options.ctx, etag)
      if (!info) throw objectError(ObjectErrorCode.dataInvalid)
      return info
    } catch (cause) {
      /** The native HeadObject failure is the first cause of an already-confirmed write. */
      const original =
        cause instanceof Error &&
        'code' in cause &&
        cause.code !== ObjectErrorCode.dataInvalid &&
        cause.cause !== undefined
          ? cause.cause
          : cause
      const error = objectError(ObjectErrorCode.failed, original)
      Object.defineProperty(error, 'committed', { value: true, enumerable: true })
      throw error
    }
  }

  /** Execute the original get operation using this installation's native state. */
  get: IObjectNative['get'] = async (key, logicalKey, options) => {
    let full: IBlobInfo | undefined
    if (options.range) {
      full = await this.head(key, logicalKey, options.ctx)
      if (!full) return undefined
      if (options.range.start >= full.size || full.size === 0)
        return {
          info: full,
          source: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close()
            }
          }),
          close: async () => undefined
        }
    }
    let response: GetObjectCommandOutput
    try {
      response = await this.#send<GetObjectCommandOutput>(
        new GetObjectCommand({
          Bucket: this.#options.bucket,
          Key: this.#options.prefix + key,
          Range: options.range
            ? `bytes=${options.range.start}-${options.range.end ?? ''}`
            : undefined,
          IfMatch: full?.etag
        }),
        options.ctx
      )
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      if (!full && responseStatus(cause) === 404) return undefined
      throw error
    }
    const source = response.Body?.transformToWebStream() as ReadableStream<Uint8Array> | undefined
    if (!source) throw objectError(ObjectErrorCode.dataInvalid)
    try {
      /** Range content must describe the same conditional native object snapshot. */
      if (options.range && full) {
        const end = Math.min(options.range.end ?? full.size - 1, full.size - 1)
        if (
          response.ContentRange !== `bytes ${options.range.start}-${end}/${full.size}` ||
          response.ContentLength !== end - options.range.start + 1
        )
          throw objectError(ObjectErrorCode.dataInvalid)
      }
      const info = responseInfo(logicalKey, response, full?.size)
      return {
        info,
        source,
        /** The shared blob resource cancels the native stream; EOF/error already closes it. */
        close: async () => undefined
      }
    } catch (error) {
      try {
        await source.cancel()
      } catch (cleanup) {
        this.#report(normalizeObjectError(cleanup))
      }
      throw error
    }
  }

  /** Execute the original remove operation using this installation's native state. */
  remove: IObjectNative['remove'] = async (key, ctx) => {
    if (!(await this.head(key, key, ctx))) return false
    await this.#send(
      new DeleteObjectCommand({ Bucket: this.#options.bucket, Key: this.#options.prefix + key }),
      ctx,
      true,
      true
    )
    return true
  }

  /** Execute the original list operation using this installation's native state. */
  list: IObjectNative['list'] = async (prefix, after, limit, ctx) => {
    const items: { wireKey: string; info: IBlobInfo }[] = []
    let continuation: string | undefined
    let finished = false
    while (items.length < limit && !finished) {
      const page = await this.#send<ListObjectsV2CommandOutput>(
        new ListObjectsV2Command({
          Bucket: this.#options.bucket,
          Prefix: this.#options.prefix + prefix,
          StartAfter: after === undefined ? undefined : this.#options.prefix + after,
          ContinuationToken: continuation,
          MaxKeys: Math.min(1000, limit - items.length)
        }),
        ctx
      )
      for (const entry of page.Contents ?? []) {
        if (typeof entry.Key !== 'string' || !entry.Key.startsWith(this.#options.prefix + prefix))
          throw objectError(ObjectErrorCode.dataInvalid)
        const wireKey = entry.Key.slice(this.#options.prefix.length)
        const info = await this.head(wireKey, wireKey, ctx)
        if (info) items.push({ wireKey, info })
      }
      finished = !page.IsTruncated
      continuation = page.NextContinuationToken
      if (!finished && typeof continuation !== 'string')
        throw objectError(ObjectErrorCode.dataInvalid)
    }
    return {
      items,
      ...(!finished && items.length > 0 ? { next: items[items.length - 1]!.wireKey } : {})
    }
  };

  /** Symbol cleanup retains the original report-only rejection behavior. */
  [Symbol.asyncDispose] = () => (this.#symbolic ??= this.dispose().then(undefined, this.#report))
}
