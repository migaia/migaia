import type { IAbortSignal } from '@migaia/utils/promise'
import { fromValueCodec, type ICodecStageObserver, type ICodec } from '@migaia/storage-contract'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { isUint8Array } from '@migaia/utils/bytes'
import type { IPersistStorage } from '../core/types.js'
import { createStorePersistTypeError } from '../errors.js'
import { StorePersistErrorCode } from '../error-code.js'
import { PersistCodecOutput, PersistCodecOperation } from '../state-constants.js'
import { StorePersistErrorText } from '../error-text.js'

/**
 * Keeps declared coded failures intact; raw snapshot/codec errors enter the existing encode
 * boundary.
 */
export function normalizeTransactionEncodingFailure(cause: unknown): unknown {
  if (cause instanceof Error) {
    /** Error identity is a declared data property, never a getter or transaction permission. */
    const descriptors = Object.getOwnPropertyDescriptors(cause)
    if (
      typeof descriptors.source?.value === 'string' &&
      typeof descriptors.code?.value === 'string'
    )
      return cause
  }
  return createStorePersistTypeError(
    StorePersistErrorCode.encodeFailed,
    StorePersistErrorText.transactionSnapshot,
    { cause }
  )
}

/** One immutable adapter owns the default collection value-domain and error chain. */
const collectionsCodec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))

/** Calls observation without waiting; the existing utility contains then and reporter failures. */
function observeCodec(
  observer: ICodecStageObserver | undefined,
  stage: keyof Pick<
    ICodecStageObserver,
    | 'beforeEncode'
    | 'afterEncode'
    | 'onEncodeError'
    | 'beforeDecode'
    | 'afterDecode'
    | 'onDecodeError'
  >,
  operation: string,
  codec: string,
  code?: string
): void {
  if (observer === undefined) return
  try {
    /** Dynamic ports may use accessors; reading the callback is part of observation. */
    const callback = observer[stage]
    if (callback === undefined) return
    /** Only primitives enter an observer; conversion values never leave the codec boundary. */
    const result = Reflect.apply(
      callback,
      observer,
      code === undefined ? [operation, codec] : [operation, codec, code]
    )
    observeThenableRejection(result, inspectThenable(result), (error) => observer.report(error))
  } catch (error) {
    observeThenableRejection(undefined, { error }, (failure) => observer.report(failure))
  }
}

/**
 * Provides the default JSON codec with round-trip support for `Map` and `Set`. It delegates to the
 * canonical collections codec through `fromValueCodec`. The package does not depend on concrete
 * `@migaia/storage-web` values. Encodes the whole supplied value rather than validating an
 * envelope. Encoding failures reject with ENCODE_FAILED and cause; non-string or invalid decoding
 * rejects with ENVELOPE_INVALID. Old collection markers and tuples remain ordinary data. The
 * canonical portable value-domain rejects non-finite numbers and other invalid values.
 */
export const defaultJsonCodec: ICodec = Object.freeze({
  name: collectionsCodec.name,
  output: PersistCodecOutput.text,
  async encode(value: unknown): Promise<string> {
    try {
      return await collectionsCodec.encode(value as Parameters<typeof collectionsCodec.encode>[0])
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
      return await collectionsCodec.decode(raw)
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
function assertBinaryCapable<TStorage extends Pick<IPersistStorage, 'getBytes' | 'setBytes'>>(
  storage: TStorage
): asserts storage is TStorage & Required<Pick<IPersistStorage, 'getBytes' | 'setBytes'>> {
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
export function writeEnvelope(
  storage: IPersistStorage,
  key: string,
  codec: ICodec,
  value: unknown,
  ctx: { signal?: IAbortSignal }
): Promise<void> {
  return writeEnvelopeWithStages(storage, key, codec, value, ctx)
}

/** Internal attachment entry adds its observer while preserving the public helper's shape. */
export async function writeEnvelopeWithStages(
  storage: Pick<IPersistStorage, 'capabilities' | 'set' | 'getBytes' | 'setBytes'>,
  key: string,
  codec: ICodec,
  value: unknown,
  ctx: { signal?: IAbortSignal },
  observer?: ICodecStageObserver,
  normalizeEncodeFailure?: (cause: unknown) => unknown,
  beforeWrite?: () => Promise<void>
): Promise<void> {
  if (codec.output === PersistCodecOutput.structured) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecOutputMismatch,
      StorePersistErrorText.structuredOutput(codec.name)
    )
  }
  observeCodec(observer, 'beforeEncode', PersistCodecOperation.encode, codec.name)
  /** The codec result is observed once, before the selected backend receives it. */
  let encoded: unknown
  try {
    encoded = await codec.encode(value, ctx)
    // Queued requests own the completed codec bytes before a later source mutation can reach them.
    if (
      beforeWrite !== undefined &&
      codec.output === PersistCodecOutput.binary &&
      isUint8Array(encoded)
    )
      encoded = new Uint8Array(encoded)
  } catch (error) {
    /** Only conversion errors are normalized; native write failures below retain their own identity. */
    const failure = normalizeEncodeFailure === undefined ? error : normalizeEncodeFailure(error)
    observeCodec(
      observer,
      'onEncodeError',
      PersistCodecOperation.encode,
      codec.name,
      codec === defaultJsonCodec || failure !== error
        ? StorePersistErrorCode.encodeFailed
        : undefined
    )
    throw failure
  }
  observeCodec(observer, 'afterEncode', PersistCodecOperation.encode, codec.name)
  if (codec.output === PersistCodecOutput.binary && storage.capabilities.binary) {
    assertBinaryCapable(storage)
    if (!isUint8Array(encoded)) {
      throw createStorePersistTypeError(
        StorePersistErrorCode.codecOutputMismatch,
        StorePersistErrorText.binaryUint8(codec.name)
      )
    }
    // Conversion starts at the caller's synchronous boundary; only requests wait for earlier writes.
    if (beforeWrite !== undefined) await beforeWrite()
    await storage.setBytes(key, encoded, ctx)
    return
  }
  if (typeof encoded !== 'string') {
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecOutputMismatch,
      StorePersistErrorText.stringOutput(codec.name)
    )
  }
  if (beforeWrite !== undefined) await beforeWrite()
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
export function readEnvelope(
  storage: IPersistStorage,
  key: string,
  codec: ICodec,
  ctx: { signal?: IAbortSignal }
): Promise<unknown | undefined> {
  return readEnvelopeWithStages(storage, key, codec, ctx)
}

/** Internal read entry shares the exact codec boundary without extending the public helper API. */
export async function readEnvelopeWithStages(
  storage: IPersistStorage,
  key: string,
  codec: ICodec,
  ctx: { signal?: IAbortSignal },
  observer?: ICodecStageObserver
): Promise<unknown | undefined> {
  if (codec.output === PersistCodecOutput.binary && storage.capabilities.binary) {
    assertBinaryCapable(storage)
    const bytes = await storage.getBytes(key, ctx)
    if (bytes === null) return undefined
    return decodeObserved(bytes)
  }
  if (codec.output === PersistCodecOutput.binary) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.codecOutputMismatch,
      StorePersistErrorText.binaryRead(codec.name)
    )
  }
  const text = await storage.get(key, ctx)
  if (text === null) return undefined
  return decodeObserved(text)

  /** Both storage routes share one conversion boundary and preserve the original failure. */
  async function decodeObserved(raw: unknown): Promise<unknown> {
    observeCodec(observer, 'beforeDecode', PersistCodecOperation.decode, codec.name)
    try {
      /** After observation runs only when the actual codec succeeds. */
      const value = await codec.decode(raw, ctx)
      observeCodec(observer, 'afterDecode', PersistCodecOperation.decode, codec.name)
      return value
    } catch (error) {
      observeCodec(
        observer,
        'onDecodeError',
        PersistCodecOperation.decode,
        codec.name,
        codec === defaultJsonCodec ? StorePersistErrorCode.envelopeInvalid : undefined
      )
      throw error
    }
  }
}

/**
 * Removes one archive from the codec's channel and preserves backend failures unchanged; does not
 * change any in-memory unit. A binary codec selects byte removal; missing byte deletion rejects
 * with the existing BACKEND_CAPABILITY TypeError.
 */
export async function removeEnvelope(
  storage: IPersistStorage,
  key: string,
  ctx: { signal?: IAbortSignal },
  codec: ICodec = defaultJsonCodec
): Promise<void> {
  if (codec.output === PersistCodecOutput.binary && storage.capabilities.binary) {
    if (typeof storage.removeBytes !== 'function') {
      throw createStorePersistTypeError(
        StorePersistErrorCode.backendCapability,
        StorePersistErrorText.binaryRemoval
      )
    }
    await storage.removeBytes(key, ctx)
    return
  }
  await storage.remove(key, ctx)
}
