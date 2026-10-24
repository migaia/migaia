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
} from '@migaia/storage-host/authoring/backend'
import type { IOperationContext } from '@migaia/storage-contract'
import { Archive } from './constants.js'
import { invalidSegment, archiveError } from './errors.js'
import { ArchiveErrorCode } from './error-code.js'

/** One canonical versioned codec owns hot comparison, wire lines and restored values. */
export const archiveCodec = defineCollectionsJsonCodec({ version: 1 })
/** A segment retains only its current detached rows and their once-encoded line representation. */
export type IArchiveRow = Readonly<{ key: string; encoded: string; bytes: Uint8Array }>
/** Detach a record through the exact archive codec, rejecting unsupported values before upload. */
export function captureRow(key: string, value: ICollectionsCodecValue): IArchiveRow {
  const encoded = archiveCodec.encode({ version: Archive.version, state: { key, value } })
  return { key, encoded, bytes: encodeUtf8(encoded + Archive.lineFeed) }
}
/** Point reads have precisely the same collections projection as cold reads and restores. */
export function normalizeValue(value: ICollectionsCodecValue): ICollectionsCodecValue {
  return decodeLine(captureRow('', value).encoded).value
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
/** Each detached chunk is enqueued once and gzip owns streaming compression/backpressure. */
export function segmentStream(rows: readonly IArchiveRow[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < rows.length) controller.enqueue(rows[index++]!.bytes)
      else controller.close()
    }
  }).pipeThrough<Uint8Array>(
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
/** Read to validated EOF even after finding the target; no segment cache survives this call. */
export async function readSegment(
  object: IBlobObject,
  key: string,
  line: number,
  ctx: IOperationContext,
  reporter: IStorageOperationReporter
): Promise<ICollectionsCodecValue> {
  let primary: unknown,
    failed = false,
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    cancellation: Promise<void> | undefined,
    unsubscribe: (() => void) | undefined
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    reader = object
      .stream()
      .pipeThrough<Uint8Array>(
        new DecompressionStream(Archive.compression) as ReadableWritablePair<Uint8Array, Uint8Array>
      )
      .getReader()
    /** Wake a blocked native read; the original finally still awaits actual cancellation cleanup. */
    unsubscribe = subscribeToAbort(
      ctx.signal,
      () => {
        try {
          cancellation = reader!.cancel(readAbortReason(ctx.signal))
        } catch (cause) {
          cancellation = Promise.reject(cause)
        }
        // This rejection is observed immediately and rethrown by the awaited original cleanup below.
        void cancellation.catch(() => undefined)
      },
      reporter
    )
    let ordinal = 0,
      found = false,
      target: ICollectionsCodecValue | undefined
    let parts: string[] = []
    /** Current-line chunks are joined once, never recopied for every incoming stream chunk. */
    const consume = (chunk: string) => {
      let start = 0,
        end: number
      while ((end = chunk.indexOf(Archive.lineFeed, start)) !== -1) {
        parts.push(chunk.slice(start, end))
        const row = decodeLine(parts.join(''))
        parts = []
        if (ordinal === line) {
          if (row.key !== key) throw invalidSegment()
          target = row.value
          found = true
        }
        ordinal++
        start = end + 1
      }
      if (start < chunk.length) parts.push(chunk.slice(start))
    }
    while (true) {
      throwIfAborted(ctx.signal)
      const item = await reader.read()
      throwIfAborted(ctx.signal)
      if (item.done) {
        consume(decoder.decode())
        if (parts.length !== 0) throw invalidSegment()
        break
      }
      consume(decoder.decode(item.value, { stream: true }))
    }
    if (!found) throw invalidSegment()
    return target!
  } catch (cause) {
    failed = true
    primary = archiveError(ArchiveErrorCode.segmentInvalid, cause)
    throw primary
  } finally {
    unsubscribe?.()
    await finishArchiveResource(
      async () => {
        let cancelError: unknown,
          failedCancel = false
        try {
          if (reader) await (cancellation ?? reader.cancel())
        } catch (cause) {
          cancelError = cause
          failedCancel = true
        } finally {
          reader?.releaseLock()
        }
        await finishArchiveResource(() => object.dispose(), failedCancel, cancelError)
        if (failedCancel) throw cancelError
      },
      failed,
      primary
    )
  }
}
