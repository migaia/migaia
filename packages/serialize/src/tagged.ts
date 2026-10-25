import { isUint8Array } from '@migaia/utils/bytes'
import { isPlainObject } from '@migaia/utils/object'
import { type ICodec, type ICodecEncodedType, normalizeCodecFailure } from './codec.js'
import { CodecErrorText } from './codec-text.js'
import { SerializeErrorCode } from './error-code.js'
import { TaggedCodecFormat } from './format-constants.js'
import { createCodecError } from './internal/codec.js'
import { SERIALIZE_TYPE_PATTERN } from './types.js'

/** Source carrier stays explicit even when unknown-carrier codecs happen to encode strings. */
type ITaggedSourceCodec<TValue, TEncoded, TFormat extends ICodecEncodedType> = ICodec<
  TValue,
  TEncoded
> & { readonly encodedType: TFormat }

/** First descriptor writes; every registered revision reads; untagged is read-only fallback. */
export type ITaggedCodecOptions<
  TValue,
  TEncoded,
  TFormat extends ICodecEncodedType = ICodecEncodedType
> = Readonly<{
  codecs: readonly [
    ITaggedSourceCodec<TValue, TEncoded, TFormat>,
    ...ITaggedSourceCodec<TValue, TEncoded, TFormat>[]
  ]
  untagged?: ITaggedSourceCodec<TValue, TEncoded, TFormat>
}>

/** Unknown-carrier wrapping freezes only this descriptor, retaining the inner encoded value. */
export type ITaggedValue<TEncoded> = Readonly<{
  '$migaia.codec': string
  value: TEncoded
}>

/** Tagged output is determined by the declared carrier, never by the inner value's runtime type. */
export type ITaggedEncoded<
  TEncoded,
  TFormat extends ICodecEncodedType = ICodecEncodedType
> = TFormat extends 'string'
  ? string
  : TFormat extends 'uint8array'
    ? Uint8Array
    : ITaggedValue<TEncoded>

/** Synchronous format router also accepts raw legacy input when an untagged reader is configured. */
export type ITaggedCodec<
  TValue,
  TEncoded,
  TFormat extends ICodecEncodedType = ICodecEncodedType
> = Readonly<{
  id: 'tagged'
  version: 1
  encodedType: TFormat
  encode: (value: TValue) => ITaggedEncoded<TEncoded, TFormat>
  decode: (value: ITaggedEncoded<TEncoded, TFormat> | TEncoded) => TValue
}>

/** Per-instance descriptor snapshot avoids rereading identity or callback getters during routing. */
type ICapturedCodec<TValue, TEncoded> = Readonly<{
  tag: string
  encodedType: ICodecEncodedType
  encode: (value: TValue) => TEncoded
  decode: (value: TEncoded) => TValue
}>

/** Captures and admits a descriptor before routing state is published; access errors retain cause. */
function captureCodec<TValue, TEncoded>(
  codec: ICodec<TValue, TEncoded>
): ICapturedCodec<TValue, TEncoded> {
  try {
    if (codec === null || typeof codec !== 'object')
      throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.taggedOptionsInvalid)
    /**
     * Identity and callbacks belong to the construction snapshot, including their original
     * receiver.
     */
    const { id, version, encodedType, encode, decode } = codec
    if (
      typeof id !== 'string' ||
      !SERIALIZE_TYPE_PATTERN.test(id) ||
      !Number.isSafeInteger(version) ||
      version <= 0 ||
      (encodedType !== 'unknown' && encodedType !== 'string' && encodedType !== 'uint8array') ||
      typeof encode !== 'function' ||
      typeof decode !== 'function'
    )
      throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.taggedOptionsInvalid)
    return {
      tag: `${id}${TaggedCodecFormat.tagSeparator}${version}`,
      encodedType,
      encode: (value) => Reflect.apply(encode, codec, [value]),
      decode: (value) => Reflect.apply(decode, codec, [value])
    }
  } catch (cause) {
    throw normalizeCodecFailure(
      cause,
      SerializeErrorCode.invalidOption,
      CodecErrorText.taggedOptionsInvalid
    )
  }
}

/** Validates a complete canonical tag before its O(1) descriptor lookup. */
function assertTag(tag: unknown): asserts tag is string {
  if (typeof tag === 'string') {
    /** The separator cannot occur in a valid id, so one split is sufficient. */
    const separator = tag.indexOf(TaggedCodecFormat.tagSeparator)
    /** Numeric conversion is bounded by the header length and checked against canonical spelling. */
    const version = Number(tag.slice(separator + 1))
    if (
      separator > 0 &&
      SERIALIZE_TYPE_PATTERN.test(tag.slice(0, separator)) &&
      Number.isSafeInteger(version) &&
      version > 0 &&
      String(version) === tag.slice(separator + 1)
    )
      return
  }
  throw createCodecError(SerializeErrorCode.tagInvalid, CodecErrorText.tagInvalid)
}

/**
 * Creates a frozen format router without storage or lifecycle ownership. Identity, methods, and the
 * fixed write header are captured once. Text prefix collisions are treated as tagged input;
 * malformed headers never fall back. Inner failures retain serialize identity or exact cause.
 */
export function createTaggedCodec<TValue, TEncoded, const TFormat extends ICodecEncodedType>(
  options: ITaggedCodecOptions<TValue, TEncoded, TFormat>
): ITaggedCodec<TValue, TEncoded, TFormat> {
  /** One map owns registered format revisions; no per-request cache grows over time. */
  const readers = new Map<string, ICapturedCodec<TValue, TEncoded>>()
  /** Fixed first writer; assigned only after a nonempty admitted source list. */
  let writer: ICapturedCodec<TValue, TEncoded>
  /** Optional fallback is captured independently and never participates in writes. */
  let untagged: ICapturedCodec<TValue, TEncoded> | undefined
  try {
    /** Snapshot option fields once before descriptor admission. */
    const { codecs, untagged: fallback } = options
    if (!Array.isArray(codecs) || codecs.length === 0)
      throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.taggedOptionsInvalid)
    for (const source of codecs) {
      /** Each admitted revision gets one immutable identity and method snapshot. */
      const captured = captureCodec<TValue, TEncoded>(source)
      if (
        readers.has(captured.tag) ||
        (readers.size > 0 && captured.encodedType !== writer!.encodedType)
      )
        throw createCodecError(
          SerializeErrorCode.invalidOption,
          CodecErrorText.taggedOptionsInvalid
        )
      if (readers.size === 0) writer = captured
      readers.set(captured.tag, captured)
    }
    if (fallback !== undefined) {
      untagged = captureCodec(fallback)
      if (untagged.encodedType !== writer!.encodedType)
        throw createCodecError(
          SerializeErrorCode.invalidOption,
          CodecErrorText.taggedOptionsInvalid
        )
    }
  } catch (cause) {
    throw normalizeCodecFailure(
      cause,
      SerializeErrorCode.invalidOption,
      CodecErrorText.taggedOptionsInvalid
    )
  }
  /** Fixed identity is ASCII by admission, so its character codes are exactly UTF-8 bytes. */
  const tagBytes = Uint8Array.from(writer!.tag, (char) => char.charCodeAt(0))
  /** Cached binary header is copied with the untouched payload into one fresh output allocation. */
  const binaryHeader = new Uint8Array(TaggedCodecFormat.binaryHeaderLength + tagBytes.length)
  binaryHeader.set(TaggedCodecFormat.binaryMagic)
  binaryHeader[4] = TaggedCodecFormat.version
  binaryHeader[5] = tagBytes.length >>> 8
  binaryHeader[6] = tagBytes.length & 255
  binaryHeader.set(tagBytes, TaggedCodecFormat.binaryHeaderLength)
  /** Cached string header avoids reconstructing fixed identity on every write. */
  const textHeader = `${TaggedCodecFormat.textPrefix}${writer!.tag}${TaggedCodecFormat.textSeparator}`
  /** Untagged routing is explicit and cannot guess a registered codec. */
  const decodeUntagged = (value: TEncoded): TValue => {
    if (untagged === undefined)
      throw createCodecError(SerializeErrorCode.tagMissing, CodecErrorText.tagMissing)
    return untagged.decode(value)
  }
  /** Syntactically valid tags must name an admitted reader; no fallback is attempted. */
  const decodeTagged = (tag: unknown, value: TEncoded): TValue => {
    assertTag(tag)
    /** One exact lookup selects only the registered revision. */
    const reader = readers.get(tag)
    if (reader === undefined)
      throw createCodecError(SerializeErrorCode.tagUnknown, CodecErrorText.tagUnknown)
    return reader.decode(value)
  }
  return Object.freeze({
    id: TaggedCodecFormat.id,
    version: TaggedCodecFormat.version,
    encodedType: writer!.encodedType as TFormat,
    encode: (value: TValue): ITaggedEncoded<TEncoded, TFormat> => {
      try {
        /** Delegate once before framing; failures keep their original boundary identity. */
        const encoded = writer!.encode(value)
        if (writer!.encodedType === 'string') {
          if (typeof encoded !== 'string')
            throw createCodecError(SerializeErrorCode.encodeFailed, CodecErrorText.encodeFailed)
          return (textHeader + encoded) as ITaggedEncoded<TEncoded, TFormat>
        }
        if (writer!.encodedType === 'uint8array') {
          if (!isUint8Array(encoded))
            throw createCodecError(SerializeErrorCode.encodeFailed, CodecErrorText.encodeFailed)
          /** One owned allocation copies the cached header and the borrowed inner payload. */
          const result = new Uint8Array(binaryHeader.length + encoded.length)
          result.set(binaryHeader)
          result.set(encoded, binaryHeader.length)
          return result as ITaggedEncoded<TEncoded, TFormat>
        }
        return Object.freeze({
          [TaggedCodecFormat.marker]: writer!.tag,
          [TaggedCodecFormat.value]: encoded
        }) as ITaggedEncoded<TEncoded, TFormat>
      } catch (cause) {
        throw normalizeCodecFailure(
          cause,
          SerializeErrorCode.encodeFailed,
          CodecErrorText.encodeFailed
        )
      }
    },
    decode: (value: ITaggedEncoded<TEncoded, TFormat> | TEncoded): TValue => {
      try {
        if (writer!.encodedType === 'string' && typeof value === 'string') {
          if (!value.startsWith(TaggedCodecFormat.textPrefix))
            return decodeUntagged(value as TEncoded)
          /** The first delimiter terminates the header; payload text stays untouched. */
          const end = value.indexOf(
            TaggedCodecFormat.textSeparator,
            TaggedCodecFormat.textPrefix.length
          )
          if (end === -1)
            throw createCodecError(SerializeErrorCode.tagInvalid, CodecErrorText.tagInvalid)
          return decodeTagged(
            value.slice(TaggedCodecFormat.textPrefix.length, end),
            value.slice(end + 1) as TEncoded
          )
        }
        if (writer!.encodedType === 'uint8array' && isUint8Array(value)) {
          if (!TaggedCodecFormat.binaryMagic.every((byte, index) => value[index] === byte))
            return decodeUntagged(value as TEncoded)
          if (
            value.length < TaggedCodecFormat.binaryHeaderLength ||
            value[4] !== TaggedCodecFormat.version
          )
            throw createCodecError(SerializeErrorCode.tagInvalid, CodecErrorText.tagInvalid)
          /** Claimed header length is checked before creating the borrowed payload view. */
          const end = TaggedCodecFormat.binaryHeaderLength + ((value[5]! << 8) | value[6]!)
          if (end > value.length)
            throw createCodecError(SerializeErrorCode.tagInvalid, CodecErrorText.tagInvalid)
          /** Admitted identities are ASCII, whose one-byte UTF-8 spelling decodes directly. */
          const tag = Array.from(
            value.subarray(TaggedCodecFormat.binaryHeaderLength, end),
            (byte) => String.fromCharCode(byte)
          ).join('')
          return decodeTagged(tag, value.subarray(end) as TEncoded)
        }
        if (
          writer!.encodedType === 'unknown' &&
          isPlainObject(value) &&
          Object.hasOwn(value, TaggedCodecFormat.marker)
        ) {
          /** Capture the own discriminator once before selecting its reader. */
          const tag = value[TaggedCodecFormat.marker]
          if (typeof tag === 'string') {
            if (!Object.hasOwn(value, TaggedCodecFormat.value))
              throw createCodecError(SerializeErrorCode.tagInvalid, CodecErrorText.tagInvalid)
            return decodeTagged(tag, value[TaggedCodecFormat.value] as TEncoded)
          }
        }
        return decodeUntagged(value as TEncoded)
      } catch (cause) {
        throw normalizeCodecFailure(
          cause,
          SerializeErrorCode.decodeFailed,
          CodecErrorText.decodeFailed
        )
      }
    }
  })
}
