import type { IAbortSignal } from '@migaia/utils/promise'
import {
  collectionsJsonCodec,
  COLLECTIONS_JSON_CODEC_NAME,
  type ICodec
} from '@migaia/storage-contract'
import { isUint8Array } from '@migaia/utils/bytes'
import type { IPersistStorage, IPersistByteStorage } from '../core/types.js'
import { createStorePersistTypeError } from '../errors.js'
import { StorePersistErrorCode } from '../error-code.js'
import { PersistCodecOutput } from '../state-constants.js'
import { StorePersistErrorText } from '../error-text.js'

/** Exact legacy one-key archive marker; extra fields remain ordinary user data. */
const MAP_TAG = '__migaia_persist_map__'
/** Exact legacy Set archive marker; the current writer uses canonical versioned tuples. */
const SET_TAG = '__migaia_persist_set__'

/** Explicitly recognizes only the two legacy tags; ordinary JSON never enters this migration path. */
function legacyReviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    /** Only sole-marker records belong to the reserved legacy archive grammar. */
    const record = value as Record<string, unknown>
    if (Object.keys(record).length !== 1) return value
    if (Object.hasOwn(record, MAP_TAG) && Array.isArray(record[MAP_TAG]))
      return new Map(record[MAP_TAG] as [unknown, unknown][])
    if (Object.hasOwn(record, SET_TAG) && Array.isArray(record[SET_TAG]))
      return new Set(record[SET_TAG] as unknown[])
  }
  return value
}

/**
 * Provides the default JSON codec with round-trip support for `Map` and `Set`. It delegates to
 * `storage-contract`'s `collectionsJsonCodec` and also reads legacy collection tags. The package
 * does not depend on concrete `@migaia/storage-web` values. Encodes the whole supplied value rather
 * than validating an envelope. Encoding failures reject with ENCODE_FAILED and cause; non-string or
 * invalid decoding rejects with ENVELOPE_INVALID. Exact sole-marker legacy records occupy reserved
 * shapes; lookalikes with extra fields remain application data. A legacy archive is decoded on its
 * legacy path without reinterpreting its ordinary arrays as new collection tuples.
 */
export const defaultJsonCodec: ICodec = Object.freeze({
  name: COLLECTIONS_JSON_CODEC_NAME,
  output: PersistCodecOutput.text,
  async encode(value: unknown): Promise<string> {
    try {
      return await collectionsJsonCodec.encode(value)
    } catch (cause) {
      throw createStorePersistTypeError(
        StorePersistErrorCode.encodeFailed,
        StorePersistErrorText.jsonSerialize,
        { cause }
      )
    }
  },
  async decode(raw: unknown): Promise<unknown> {
    if (typeof raw !== 'string')
      throw createStorePersistTypeError(
        StorePersistErrorCode.envelopeInvalid,
        StorePersistErrorText.jsonPayload
      )
    try {
      /** Legacy detection is explicit and exact; unrecognized lookalikes remain ordinary JSON. */
      let legacyFound = false
      /** Preserve legacy application arrays instead of interpreting them as new-format tuples. */
      const parsed = JSON.parse(raw, (key, value: unknown) => {
        /** A changed value identifies an exact legacy marker in this archive. */
        const migrated = legacyReviver(key, value)
        if (migrated !== value) legacyFound = true
        return migrated
      })
      if (legacyFound) return parsed
      return await collectionsJsonCodec.decode(raw)
    } catch (cause) {
      throw createStorePersistTypeError(
        StorePersistErrorCode.envelopeInvalid,
        StorePersistErrorText.jsonPayload,
        { cause }
      )
    }
  }
})

/**
 * 选路：codec.output 与后端 capabilities 是否匹配，决定编码后的值往 text 通道还是 bytes 通道落地。
 *
 * 只覆盖 text/binary 两种 output——`structured` 需要 storage-web L1 `IRecordStore` 的
 * `putRecord`/`getRecord`，这个最小 `IPersistStorage` 形状不声明这两个方法， 传入 structured codec 会在写入时明确抛错，而不是静默按
 * text 处理。
 */
function assertBinaryCapable(storage: IPersistStorage): asserts storage is IPersistByteStorage {
  if (typeof storage.getBytes !== 'function' || typeof storage.setBytes !== 'function') {
    throw createStorePersistTypeError(
      StorePersistErrorCode.backendCapability,
      StorePersistErrorText.binaryBackend
    )
  }
}

/**
 * Encodes a supplied value and writes one key, forwarding the required context and optional signal.
 * Structured output is rejected before encoding. Binary output with capabilities.binary uses
 * getBytes/setBytes support and requires an intrinsic Uint8Array; other routes require a string for
 * storage.set. No base64 conversion or envelope validation is added. Capability/output mismatches
 * reject locally; codec and adapter failures otherwise propagate from their owners.
 */
export async function writeEnvelope(
  storage: IPersistStorage,
  key: string,
  codec: ICodec,
  value: unknown,
  ctx: { signal?: IAbortSignal }
): Promise<void> {
  if (codec.output === PersistCodecOutput.structured) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecOutputMismatch,
      StorePersistErrorText.structuredOutput(codec.name)
    )
  }
  const encoded = await codec.encode(value, ctx)
  if (codec.output === PersistCodecOutput.binary && storage.capabilities.binary) {
    assertBinaryCapable(storage)
    if (!isUint8Array(encoded)) {
      throw createStorePersistTypeError(
        StorePersistErrorCode.codecOutputMismatch,
        StorePersistErrorText.binaryUint8(codec.name)
      )
    }
    await storage.setBytes(key, encoded, ctx)
    return
  }
  if (typeof encoded !== 'string') {
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecOutputMismatch,
      StorePersistErrorText.stringOutput(codec.name)
    )
  }
  await storage.set(key, encoded, ctx)
}

/**
 * Reads and decodes one archive; a null storage miss skips decoding and returns undefined.
 * Otherwise it returns the codec's decoded value unchanged. Binary output requires
 * capabilities.binary and both byte methods; otherwise it rejects with a capability/output
 * mismatch. Other outputs read the text route, including structured codecs whose writes this
 * package rejects. Forwards context/signal unchanged; does not validate the decoded envelope or try
 * a second channel when a key is absent. Owner failures propagate.
 */
export async function readEnvelope(
  storage: IPersistStorage,
  key: string,
  codec: ICodec,
  ctx: { signal?: IAbortSignal }
): Promise<unknown | undefined> {
  if (codec.output === PersistCodecOutput.binary && storage.capabilities.binary) {
    assertBinaryCapable(storage)
    const bytes = await storage.getBytes(key, ctx)
    if (bytes === null) return undefined
    return codec.decode(bytes, ctx)
  }
  if (codec.output === PersistCodecOutput.binary) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecOutputMismatch,
      StorePersistErrorText.binaryRead(codec.name)
    )
  }
  const text = await storage.get(key, ctx)
  if (text === null) return undefined
  return codec.decode(text, ctx)
}

/**
 * Delegates removal of one key to borrowed storage with the supplied context/signal. Resolves after
 * storage.remove settles, propagating its failure; does not change any in-memory unit.
 */
export async function removeEnvelope(
  storage: IPersistStorage,
  key: string,
  ctx: { signal?: IAbortSignal }
): Promise<void> {
  await storage.remove(key, ctx)
}
