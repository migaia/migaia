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
import {
  invalidArgument,
  normalizeObjectError,
  objectError,
  captureObjectOptions
} from './errors.js'
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
/** Capture native options and keep connection construction inside the original install window. */
export function s3ObjectDriver(options: IS3ObjectDriverOptions): IObjectDriver {
  const supplied = captureObjectOptions(() => ({
    client: options?.client,
    config: options?.config,
    bucket: options?.bucket,
    prefix: options?.prefix,
    threshold: options?.multipartThresholdBytes,
    partBytes: options?.partBytes,
    concurrency: options?.partConcurrency
  }))
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
  return defineObjectDriver(ObjectDriverKind.s3, async ({ report }): Promise<IObjectNative> => {
    const client = captured.client ?? new S3Client(captured.config!)
    const send = createObjectSender(client)
    let conditional = false
    let primary: Promise<void> | undefined
    let symbolic: Promise<void> | undefined
    const address = (key: string) => ({ bucket: captured.bucket, key: captured.prefix + key })
    /** Borrowed SDK clients keep their caller-owned connection and configuration lifetime. */
    const dispose = (): Promise<void> =>
      (primary ??= Promise.resolve().then(() => {
        if (!captured.client) client.destroy()
      }))
    /** Missing response metadata is corruption, and 403/network errors never become misses. */
    const head = async (
      key: string,
      logicalKey: string,
      ctx?: IOperationContext,
      ifMatch?: string
    ): Promise<IBlobInfo | undefined> => {
      try {
        return responseInfo(
          logicalKey,
          await send<HeadObjectCommandOutput>(
            new HeadObjectCommand({
              Bucket: captured.bucket,
              Key: captured.prefix + key,
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
    return {
      kind: ObjectDriverKind.s3,
      client,
      address,
      async detect(signal) {
        await send(new HeadBucketCommand({ Bucket: captured.bucket }), { signal })
        const probe = captured.prefix + ObjectNames.probe + crypto.randomUUID()
        let attempted = false
        let failure: unknown
        conditional = false
        try {
          attempted = true
          const first = await send<PutObjectCommandOutput>(
            new PutObjectCommand({
              Bucket: captured.bucket,
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
              await send(
                new PutObjectCommand({
                  Bucket: captured.bucket,
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
          conditional = true
        } catch (error) {
          failure = error
          report(error)
        } finally {
          if (attempted)
            try {
              await send(
                new DeleteObjectCommand({ Bucket: captured.bucket, Key: probe }),
                undefined,
                true
              )
            } catch (error) {
              conditional = false
              const cleanup = new Error(ObjectErrorText.probeCleanup(probe), {
                cause:
                  failure === undefined
                    ? error
                    : new AggregateError([failure, error], ObjectErrorText.failed)
              })
              report(objectError(ObjectErrorCode.failed, cleanup))
            }
        }
      },
      async put(key, logicalKey, body, options) {
        const hasCondition = options.ifMatch !== undefined || options.ifNoneMatch === true
        if (hasCondition && !conditional)
          throw new StorageContractError(
            StorageContractErrorCode.unsupported,
            { backend: ObjectNames.backend },
            ObjectErrorText.conditional
          )
        assertS3ObjectHeaders(options)
        let etag: string
        if (!isUint8Array(body) || body.byteLength >= captured.threshold)
          etag = await uploadMultipart(
            send,
            captured.bucket,
            captured.prefix + key,
            body,
            options,
            captured.partBytes,
            captured.concurrency,
            report
          )
        else {
          const result = await send<PutObjectCommandOutput>(
            new PutObjectCommand({
              Bucket: captured.bucket,
              Key: captured.prefix + key,
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
          const info = await head(key, logicalKey, options.ctx, etag)
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
      },
      async get(key, logicalKey, options) {
        let full: IBlobInfo | undefined
        if (options.range) {
          full = await head(key, logicalKey, options.ctx)
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
          response = await send<GetObjectCommandOutput>(
            new GetObjectCommand({
              Bucket: captured.bucket,
              Key: captured.prefix + key,
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
        const source = response.Body?.transformToWebStream() as
          | ReadableStream<Uint8Array>
          | undefined
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
            report(normalizeObjectError(cleanup))
          }
          throw error
        }
      },
      head,
      async remove(key, ctx) {
        if (!(await head(key, key, ctx))) return false
        await send(
          new DeleteObjectCommand({ Bucket: captured.bucket, Key: captured.prefix + key }),
          ctx,
          true,
          true
        )
        return true
      },
      async list(prefix, after, limit, ctx) {
        const items: { wireKey: string; info: IBlobInfo }[] = []
        let continuation: string | undefined
        let finished = false
        while (items.length < limit && !finished) {
          const page = await send<ListObjectsV2CommandOutput>(
            new ListObjectsV2Command({
              Bucket: captured.bucket,
              Prefix: captured.prefix + prefix,
              StartAfter: after === undefined ? undefined : captured.prefix + after,
              ContinuationToken: continuation,
              MaxKeys: Math.min(1000, limit - items.length)
            }),
            ctx
          )
          for (const entry of page.Contents ?? []) {
            if (typeof entry.Key !== 'string' || !entry.Key.startsWith(captured.prefix + prefix))
              throw objectError(ObjectErrorCode.dataInvalid)
            const wireKey = entry.Key.slice(captured.prefix.length)
            const info = await head(wireKey, wireKey, ctx)
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
      },
      dispose,
      [Symbol.asyncDispose]: () => (symbolic ??= dispose().then(undefined, report))
    }
  })
}
