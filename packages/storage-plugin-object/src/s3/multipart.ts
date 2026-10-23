import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectCommand,
  type CreateMultipartUploadCommandOutput,
  type UploadPartCommandOutput,
  type CompleteMultipartUploadCommandOutput,
  type PutObjectCommandOutput
} from '@aws-sdk/client-s3'
import {
  StorageContractError,
  createStorageBlobBodyReader,
  type IBlobApi
} from '@migaia/storage-contract'
import {
  subscribeToAbort,
  readAbortReason,
  throwIfAborted
} from '@migaia/storage-host/authoring/backend'
import { isUint8Array } from '@migaia/utils/bytes'
import { ObjectNames } from '../constants.js'
import { ObjectErrorText } from '../error-text.js'
import { ERROR_SOURCE, ObjectErrorCode, type IObjectErrorCode } from '../error-code.js'
import { invalidArgument, normalizeObjectError, objectError } from '../errors.js'
import type { createObjectSender } from './send.js'
/**
 * Multipart retains at most concurrency outstanding part buffers and one assembling buffer, plus
 * the current input chunk. The first failure stops admission, drains requests, then aborts once.
 */
export async function uploadMultipart(
  send: ReturnType<typeof createObjectSender>,
  bucket: string,
  key: string,
  body: Parameters<IBlobApi['put']>[1],
  options: NonNullable<Parameters<IBlobApi['put']>[2]>,
  partBytes: number,
  concurrency: number,
  report: (error: unknown) => void
): Promise<string> {
  if (isUint8Array(body) && Math.ceil(body.byteLength / partBytes) > ObjectNames.maximumParts)
    throw invalidArgument()
  const reader = createStorageBlobBodyReader(body, {
    backend: ObjectNames.backend,
    report,
    normalizeFailure: normalizeObjectError
  })
  let chunk: Uint8Array = new Uint8Array(0)
  let offset = 0
  let uploadId: string | undefined
  let completed = false
  let failure: unknown
  let failed = false
  const jobs = new Set<Promise<void>>()
  const parts: { PartNumber: number; ETag: string }[] = []
  const stop = subscribeToAbort(
    options.ctx?.signal,
    () => {
      // Symbolic disposal below reports the original cached cleanup failure exactly once.
      void reader.return?.(readAbortReason(options.ctx?.signal))
    },
    report
  )
  /** Read each source chunk once and assemble only the next bounded native part. */
  const nextPart = async (): Promise<Uint8Array | undefined> => {
    const part = new Uint8Array(partBytes)
    let size = 0
    while (size < partBytes) {
      throwIfAborted(options.ctx?.signal)
      if (offset === chunk.byteLength) {
        const next = await reader.next()
        throwIfAborted(options.ctx?.signal)
        if (next.done) {
          break
        }
        chunk = next.value
        offset = 0
      }
      const count = Math.min(partBytes - size, chunk.byteLength - offset)
      part.set(chunk.subarray(offset, offset + count), size)
      offset += count
      size += count
    }
    return size === 0 ? undefined : size === partBytes ? part : part.subarray(0, size)
  }
  try {
    let part = await nextPart()
    if (!part) {
      const result = await send<PutObjectCommandOutput>(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: new Uint8Array(0),
          ContentType: options.contentType,
          Metadata: options.metadata,
          IfMatch: options.ifMatch,
          IfNoneMatch: options.ifNoneMatch ? '*' : undefined
        }),
        options.ctx,
        true,
        true,
        options.ifMatch !== undefined || options.ifNoneMatch === true
      )
      completed = true
      return result.ETag as string
    }
    const created = await send<CreateMultipartUploadCommandOutput>(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: options.contentType,
        Metadata: options.metadata
      }),
      options.ctx,
      true
    )
    uploadId = created.UploadId
    if (typeof uploadId !== 'string') throw objectError(ObjectErrorCode.dataInvalid)
    let number = 0
    while (part && !failed) {
      if (++number > ObjectNames.maximumParts) throw invalidArgument()
      const partNumber = number
      const pending = send<UploadPartCommandOutput>(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: part
        }),
        options.ctx,
        true
      )
        .then((result) => {
          if (typeof result.ETag !== 'string') throw objectError(ObjectErrorCode.dataInvalid)
          parts[partNumber - 1] = { PartNumber: partNumber, ETag: result.ETag }
        })
        .catch((error) => {
          if (!failed) {
            failure = error
            failed = true
            void reader.return?.(error)
          }
        })
        .finally(() => {
          jobs.delete(pending)
        })
      jobs.add(pending)
      if (jobs.size >= concurrency) await Promise.race(jobs)
      if (failed) break
      part = await nextPart()
    }
    await Promise.all(jobs)
    if (failed) throw failure
    throwIfAborted(options.ctx?.signal)
    const result = await send<CompleteMultipartUploadCommandOutput>(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
        IfMatch: options.ifMatch,
        IfNoneMatch: options.ifNoneMatch ? '*' : undefined
      }),
      options.ctx,
      true,
      true,
      options.ifMatch !== undefined || options.ifNoneMatch === true
    )
    completed = true
    return result.ETag as string
  } catch (error) {
    let primary = normalizeObjectError(error)
    void reader.return?.(primary)
    await reader[Symbol.asyncDispose]()
    await Promise.all(jobs)
    if (uploadId && !completed)
      try {
        await send(
          new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
          undefined,
          true
        )
      } catch (cleanup) {
        const aggregate = new AggregateError([primary, cleanup], ObjectErrorText.failed)
        Object.defineProperty(aggregate, 'uploadId', { value: uploadId, enumerable: true })
        report(normalizeObjectError(cleanup))
        primary =
          primary instanceof StorageContractError
            ? new StorageContractError(primary.code, {
                backend: ObjectNames.backend,
                cause: aggregate
              })
            : objectError(
                'source' in primary && primary.source === ERROR_SOURCE && 'code' in primary
                  ? (primary.code as IObjectErrorCode)
                  : ObjectErrorCode.failed,
                aggregate
              )
      }
    throw primary
  } finally {
    stop()
    await reader[Symbol.asyncDispose]()
  }
}
