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
import { StorageContractError, type IBlobApi } from '@migaia/storage-contract'
import {
  createStorageBlobBodyReader,
  subscribeToAbort,
  readAbortReason,
  throwIfAborted
} from '@migaia/storage-host/sdk'
import { isUint8Array } from '@migaia/utils/bytes'
import { ObjectNames } from '../constants.js'
import { ObjectErrorText } from '../error-text.js'
import { STORAGE_OBJECT_ERROR_SOURCE, ObjectErrorCode } from '@migaia/storage-contract/error-code'
import type { IObjectErrorCode } from '@migaia/storage-contract/error-code'
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
  /** One upload owns bounded buffers, admission and cleanup state. */
  const upload = new ObjectMultipartUpload(
    send,
    bucket,
    key,
    body,
    options,
    partBytes,
    concurrency,
    report
  )
  return upload.run()
}

/** One multipart transfer owns its buffers and native upload lifetime. */
class ObjectMultipartUpload {
  /** Native command execution preserves original retries and error classification. */
  readonly #send: ReturnType<typeof createObjectSender>
  /** The installation selects one bucket for every issued upload command. */
  readonly #bucket: string
  /** One physical object key remains fixed until completion or abort. */
  readonly #key: string
  /** Accepted conditions and metadata remain stable across issued parts. */
  readonly #options: NonNullable<Parameters<IBlobApi['put']>[2]>
  /** The configured part bound caps each assembled native buffer. */
  readonly #partBytes: number
  /** Only this many native part requests may be outstanding. */
  readonly #concurrency: number
  /** Cleanup failures use the original host report channel. */
  readonly #report: (error: unknown) => void
  /** Exactly one canonical body reader owns input consumption and cancellation. */
  readonly #reader: ReturnType<typeof createStorageBlobBodyReader>
  /** The current source chunk supplies bytes to the next native part. */
  #chunk: Uint8Array = new Uint8Array(0)
  /** Bytes before this offset have already entered an issued part. */
  #offset: number = 0
  /** A created upload must be aborted unless completion is confirmed. */
  #uploadId: string | undefined
  /** Confirmed completion prevents aborting committed content. */
  #completed: boolean = false
  /** The first part failure remains the primary failure after draining. */
  #failure: unknown
  /** A failed part seals admission of additional native requests. */
  #failed: boolean = false
  /** Issued requests drain before abort or return. */
  #jobs: Set<Promise<void>> = new Set<Promise<void>>()
  /** Native ETags retain their part-number positions for completion. */
  #parts: { PartNumber: number; ETag: string }[] = []
  /** Cancellation subscription ends when the transfer finally settles. */
  readonly #stop: () => void
  /**
   * Validate supported limits before taking the source reader, then retain original cancellation
   * ownership.
   */
  constructor(
    send: ReturnType<typeof createObjectSender>,
    bucket: string,
    key: string,
    body: Parameters<IBlobApi['put']>[1],
    options: NonNullable<Parameters<IBlobApi['put']>[2]>,
    partBytes: number,
    concurrency: number,
    report: (error: unknown) => void
  ) {
    if (isUint8Array(body) && Math.ceil(body.byteLength / partBytes) > ObjectNames.maximumParts)
      throw invalidArgument()
    this.#send = send
    this.#bucket = bucket
    this.#key = key
    this.#options = options
    this.#partBytes = partBytes
    this.#concurrency = concurrency
    this.#report = report
    this.#reader = createStorageBlobBodyReader(body, {
      backend: ObjectNames.backend,
      report: this.#report,
      normalizeFailure: normalizeObjectError
    })
    this.#stop = subscribeToAbort(
      this.#options.ctx?.signal,
      () => {
        // Symbolic disposal below reports the original cached cleanup failure exactly once.
        void this.#reader.return?.(readAbortReason(this.#options.ctx?.signal))
      },
      this.#report
    )
  }
  /** Assemble only the next native part, consuming each source chunk once. */
  #nextPart = async (): Promise<Uint8Array | undefined> => {
    const part = new Uint8Array(this.#partBytes)
    let size = 0
    while (size < this.#partBytes) {
      throwIfAborted(this.#options.ctx?.signal)
      if (this.#offset === this.#chunk.byteLength) {
        const next = await this.#reader.next()
        throwIfAborted(this.#options.ctx?.signal)
        if (next.done) {
          break
        }
        this.#chunk = next.value
        this.#offset = 0
      }
      const count = Math.min(this.#partBytes - size, this.#chunk.byteLength - this.#offset)
      part.set(this.#chunk.subarray(this.#offset, this.#offset + count), size)
      this.#offset += count
      size += count
    }
    return size === 0 ? undefined : size === this.#partBytes ? part : part.subarray(0, size)
  }
  /**
   * Admit bounded native requests, preserve the first failure, and perform original
   * completion/abort cleanup.
   */
  async run(): Promise<string> {
    try {
      let part = await this.#nextPart()
      if (!part) {
        const result = await this.#send<PutObjectCommandOutput>(
          new PutObjectCommand({
            Bucket: this.#bucket,
            Key: this.#key,
            Body: new Uint8Array(0),
            ContentType: this.#options.contentType,
            Metadata: this.#options.metadata,
            IfMatch: this.#options.ifMatch,
            IfNoneMatch: this.#options.ifNoneMatch ? '*' : undefined
          }),
          this.#options.ctx,
          true,
          true,
          this.#options.ifMatch !== undefined || this.#options.ifNoneMatch === true
        )
        this.#completed = true
        return result.ETag as string
      }
      const created = await this.#send<CreateMultipartUploadCommandOutput>(
        new CreateMultipartUploadCommand({
          Bucket: this.#bucket,
          Key: this.#key,
          ContentType: this.#options.contentType,
          Metadata: this.#options.metadata
        }),
        this.#options.ctx,
        true
      )
      this.#uploadId = created.UploadId
      if (typeof this.#uploadId !== 'string') throw objectError(ObjectErrorCode.dataInvalid)
      let number = 0
      while (part && !this.#failed) {
        if (++number > ObjectNames.maximumParts) throw invalidArgument()
        const partNumber = number
        const pending = this.#send<UploadPartCommandOutput>(
          new UploadPartCommand({
            Bucket: this.#bucket,
            Key: this.#key,
            UploadId: this.#uploadId,
            PartNumber: partNumber,
            Body: part
          }),
          this.#options.ctx,
          true
        )
          .then((result) => {
            if (typeof result.ETag !== 'string') throw objectError(ObjectErrorCode.dataInvalid)
            this.#parts[partNumber - 1] = { PartNumber: partNumber, ETag: result.ETag }
          })
          .catch((error) => {
            if (!this.#failed) {
              this.#failure = error
              this.#failed = true
              void this.#reader.return?.(error)
            }
          })
          .finally(() => {
            this.#jobs.delete(pending)
          })
        this.#jobs.add(pending)
        if (this.#jobs.size >= this.#concurrency) await Promise.race(this.#jobs)
        if (this.#failed) break
        part = await this.#nextPart()
      }
      await Promise.all(this.#jobs)
      if (this.#failed) throw this.#failure
      throwIfAborted(this.#options.ctx?.signal)
      const result = await this.#send<CompleteMultipartUploadCommandOutput>(
        new CompleteMultipartUploadCommand({
          Bucket: this.#bucket,
          Key: this.#key,
          UploadId: this.#uploadId,
          MultipartUpload: { Parts: this.#parts },
          IfMatch: this.#options.ifMatch,
          IfNoneMatch: this.#options.ifNoneMatch ? '*' : undefined
        }),
        this.#options.ctx,
        true,
        true,
        this.#options.ifMatch !== undefined || this.#options.ifNoneMatch === true
      )
      this.#completed = true
      return result.ETag as string
    } catch (error) {
      let primary = normalizeObjectError(error)
      void this.#reader.return?.(primary)
      await this.#reader[Symbol.asyncDispose]()
      await Promise.all(this.#jobs)
      if (this.#uploadId && !this.#completed)
        try {
          await this.#send(
            new AbortMultipartUploadCommand({
              Bucket: this.#bucket,
              Key: this.#key,
              UploadId: this.#uploadId
            }),
            undefined,
            true
          )
        } catch (cleanup) {
          const aggregate = new AggregateError([primary, cleanup], ObjectErrorText.failed)
          Object.defineProperty(aggregate, 'uploadId', { value: this.#uploadId, enumerable: true })
          this.#report(normalizeObjectError(cleanup))
          primary =
            primary instanceof StorageContractError
              ? new StorageContractError(primary.code, {
                  backend: ObjectNames.backend,
                  cause: aggregate
                })
              : objectError(
                  'source' in primary &&
                    primary.source === STORAGE_OBJECT_ERROR_SOURCE &&
                    'code' in primary
                    ? (primary.code as IObjectErrorCode)
                    : ObjectErrorCode.failed,
                  aggregate
                )
        }
      throw primary
    } finally {
      this.#stop()
      await this.#reader[Symbol.asyncDispose]()
    }
  }
}
