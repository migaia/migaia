import { assertVersionedEnvelope, type IBlobObject } from '@migaia/storage-contract'
import {
  defineCollectionsJsonCodec,
  type ICollectionsCodecValue
} from '@migaia/serialize/codecs/collections-json'
import { bytesToBase64, encodeUtf8 } from '@migaia/utils/bytes'
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  throwIfAborted,
  subscribeToAbort,
  readAbortReason,
  type IStorageOperationReporter
} from '@migaia/storage-host/sdk'
import type { IOperationContext } from '@migaia/storage-contract'
import { Archive } from './constants.ts'
import { invalidSegment, archiveError } from './errors.ts'
import { ArchiveErrorCode } from '@migaia/storage-contract/error-code'

/** One canonical versioned codec owns hot comparison, wire lines and restored values. */
export const archiveCodec = defineCollectionsJsonCodec({ version: 1 })
/** A segment retains only its current detached rows and their once-encoded line representation. */
export type IArchiveRow = Readonly<{ key: string; encoded: string; bytes: Uint8Array }>
/** Encode the canonical line once; comparison and normalization need no unused UTF-8 byte buffer. */
export function encodeArchiveRow(key: string, value: ICollectionsCodecValue): string {
  return archiveCodec.encode({ version: Archive.version, state: { key, value } })
}
/** Own the candidate's wire bytes before cold upload or hot recheck can await mutable records. */
export function captureRow(key: string, value: ICollectionsCodecValue): IArchiveRow {
  const encoded = encodeArchiveRow(key, value)
  return { key, encoded, bytes: encodeUtf8(encoded + Archive.lineFeed) }
}
/** Point reads retain precisely the same collections projection as cold reads and restores. */
export function normalizeValue(value: ICollectionsCodecValue): ICollectionsCodecValue {
  return decodeLine(encodeArchiveRow('', value)).value
}
/** Codec and envelope validation precede the line/key identity checks owned by Archive. */
function decodeLine(line: string): Readonly<{ key: string; value: ICollectionsCodecValue }> {
  try {
    const envelope = assertVersionedEnvelope(archiveCodec.decode(line))
    if (
      envelope.version !== Archive.version ||
      typeof envelope.state !== 'object' ||
      envelope.state === null
    )
      throw invalidSegment()
    const state = envelope.state as Record<string, unknown>
    if (typeof state.key !== 'string' || !Object.hasOwn(state, 'value')) throw invalidSegment()
    return { key: state.key, value: state.value as ICollectionsCodecValue }
  } catch (cause) {
    throw invalidSegment(cause)
  }
}
/** Cold keys encode only plugin identity; segment IDs are native random UUIDs. */
export function archivePrefix(id: string): string {
  return `${Archive.blobPrefix}${bytesToBase64(encodeUtf8(id)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}:`
}
/** One bounded segment source owns its current line position; gzip owns compression/backpressure. */
class ArchiveSegmentSource {
  /** Rows are already owned by this flush batch and stay retained until its cold upload settles. */
  readonly #rows: readonly IArchiveRow[]
  /** Each detached wire chunk is enqueued exactly once. */
  #index = 0
  /** Borrow the original batch without another row or byte copy. */
  constructor(rows: readonly IArchiveRow[]) {
    this.#rows = rows
  }
  /** The native stream requests the next original chunk or reaches its actual end. */
  readonly pull = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (this.#index < this.#rows.length) controller.enqueue(this.#rows[this.#index++]!.bytes)
    else controller.close()
  }
}
/** Stream the original detached chunks through the native gzip implementation. */
export function segmentStream(rows: readonly IArchiveRow[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(new ArchiveSegmentSource(rows)).pipeThrough<Uint8Array>(
    new CompressionStream(Archive.compression) as ReadableWritablePair<Uint8Array, Uint8Array>
  )
}
/** Cleanup failures append to the original primary instead of replacing it. */
export async function finishArchiveResource(
  dispose: () => Promise<void>,
  failed: boolean,
  primary: unknown
): Promise<void> {
  try {
    await dispose()
  } catch (cleanup) {
    if (failed) throw cleanup === primary ? primary : attachSecondaryErrors(primary, [cleanup])
    throw cleanup
  }
}
/** One cold segment read owns decoder/line/cancel state only for the duration of that read. */
class ArchiveSegmentReader {
  /** The original blob resource remains the sole native stream and close owner. */
  readonly #object: IBlobObject
  /** The requested business key must match the selected immutable line. */
  readonly #key: string
  /** The manifest's line ordinal identifies this read's single result. */
  readonly #line: number
  /** The caller's already-captured operation context supplies the original cancellation signal. */
  readonly #ctx: IOperationContext
  /** Original operation reporting owns abort-listener failures. */
  readonly #reporter: IStorageOperationReporter
  /** Fatal UTF-8 decoding spans native decompression chunks. */
  readonly #decoder = new TextDecoder('utf-8', { fatal: true })
  /** Only this decompression reader is canceled and released by this read. */
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  /** A blocked native read retains its actual cancellation completion for cleanup. */
  #cancellation: Promise<void> | undefined
  /** The original signal subscription is removed before stream cleanup. */
  #unsubscribe: (() => void) | undefined
  /** Line chunks are joined once at each delimiter, without repeatedly copying the growing line. */
  #parts: string[] = []
  /** Ordinals count every validated line, including lines after the requested result. */
  #ordinal = 0
  /** An undefined application value remains distinct from a missing requested line. */
  #found = false
  /** Only the requested decoded value survives while the remaining segment is validated. */
  #target: ICollectionsCodecValue | undefined

  /** Bind one original blob and manifest identity without acquiring another storage resource. */
  constructor(
    object: IBlobObject,
    key: string,
    line: number,
    ctx: IOperationContext,
    reporter: IStorageOperationReporter
  ) {
    this.#object = object
    this.#key = key
    this.#line = line
    this.#ctx = ctx
    this.#reporter = reporter
  }
  /** Wake the blocked native read while retaining its real completion for the original finally. */
  #abort(): void {
    try {
      this.#cancellation = this.#reader!.cancel(readAbortReason(this.#ctx.signal))
    } catch (cause) {
      this.#cancellation = Promise.reject(cause)
    }
    // Observe now; the awaited cleanup below rethrows the same cancellation failure.
    void this.#cancellation.catch(() => undefined)
  }
  /** Validate every completed canonical line and retain only this manifest's exact key. */
  #consume(chunk: string): void {
    let start = 0,
      end: number
    while ((end = chunk.indexOf(Archive.lineFeed, start)) !== -1) {
      this.#parts.push(chunk.slice(start, end))
      const row = decodeLine(this.#parts.join(''))
      this.#parts = []
      if (this.#ordinal === this.#line) {
        if (row.key !== this.#key) throw invalidSegment()
        this.#target = row.value
        this.#found = true
      }
      this.#ordinal++
      start = end + 1
    }
    if (start < chunk.length) this.#parts.push(chunk.slice(start))
  }
  /** Release the native reader and original blob, preserving cancellation before close errors. */
  async #close(): Promise<void> {
    let cancelError: unknown,
      failedCancel = false
    try {
      if (this.#reader) await (this.#cancellation ?? this.#reader.cancel())
    } catch (cause) {
      cancelError = cause
      failedCancel = true
    } finally {
      this.#reader?.releaseLock()
    }
    await finishArchiveResource(() => this.#object.dispose(), failedCancel, cancelError)
    if (failedCancel) throw cancelError
  }
  /** Read to validated EOF even after finding the target; no segment cache survives this call. */
  async read(): Promise<ICollectionsCodecValue> {
    let primary: unknown,
      failed = false
    try {
      this.#reader = this.#object
        .stream()
        .pipeThrough<Uint8Array>(
          new DecompressionStream(Archive.compression) as ReadableWritablePair<
            Uint8Array,
            Uint8Array
          >
        )
        .getReader()
      this.#unsubscribe = subscribeToAbort(this.#ctx.signal, () => this.#abort(), this.#reporter)
      while (true) {
        throwIfAborted(this.#ctx.signal)
        const item = await this.#reader.read()
        throwIfAborted(this.#ctx.signal)
        if (item.done) {
          this.#consume(this.#decoder.decode())
          if (this.#parts.length !== 0) throw invalidSegment()
          break
        }
        this.#consume(this.#decoder.decode(item.value, { stream: true }))
      }
      if (!this.#found) throw invalidSegment()
      return this.#target!
    } catch (cause) {
      failed = true
      primary = archiveError(ArchiveErrorCode.segmentInvalid, cause)
      throw primary
    } finally {
      this.#unsubscribe?.()
      await finishArchiveResource(() => this.#close(), failed, primary)
    }
  }
}
/** Read through the original blob lifetime; the named reader retains no cross-call state. */
export function readSegment(
  object: IBlobObject,
  key: string,
  line: number,
  ctx: IOperationContext,
  reporter: IStorageOperationReporter
): Promise<ICollectionsCodecValue> {
  return new ArchiveSegmentReader(object, key, line, ctx, reporter).read()
}
