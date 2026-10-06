import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'
import { attachErrorIdentity } from './error.js'

/** Captured `%TypedArray%.prototype` used as the receiver-independent brand probe. */
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype)

/** Captured well-known symbol so later global mutation cannot redirect the typed-array probe. */
const typedArrayTag = Symbol.toStringTag

/** Captured intrinsic receiver operation so later `Reflect.get` replacement cannot forge brands. */
const intrinsicReflectGet = Reflect.get

/** Isolated holder that preserves the intrinsic typed-array tag getter after prototype mutation. */
const typedArrayBrandProbe = Object.create(null) as object

/** Captured intrinsic typed-array tag getter; it reads internal slots, not user-visible tags. */
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, typedArrayTag)?.get

if (typedArrayTagGetter !== undefined)
  Object.defineProperty(typedArrayBrandProbe, typedArrayTag, { get: typedArrayTagGetter })

/** Isolated holder for the intrinsic ArrayBuffer byte-length brand getter. */
const arrayBufferBrandProbe = Object.create(null) as object

/** Captured intrinsic ArrayBuffer byte-length getter; detached buffers retain their brand. */
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength'
)?.get

if (arrayBufferByteLengthGetter !== undefined)
  Object.defineProperty(arrayBufferBrandProbe, 'byteLength', { get: arrayBufferByteLengthGetter })

/**
 * Recognizes Uint8Array internal slots across realms and subclasses without trusting mutable
 * prototypes, constructor names, or Symbol.toStringTag properties supplied by the value.
 */
export const isUint8Array = (value: unknown): value is Uint8Array => {
  if (typedArrayTagGetter === undefined) return false
  try {
    return intrinsicReflectGet(typedArrayBrandProbe, typedArrayTag, value) === 'Uint8Array'
  } catch {
    return false
  }
}

/**
 * Recognizes ArrayBuffer internal slots across realms, including detached buffers, without
 * accepting SharedArrayBuffer, proxies, or objects that imitate the public constructor shape.
 */
export const isArrayBuffer = (value: unknown): value is ArrayBuffer => {
  if (arrayBufferByteLengthGetter === undefined) return false
  try {
    intrinsicReflectGet(arrayBufferBrandProbe, 'byteLength', value)
    return true
  } catch {
    return false
  }
}

/** Encodes bytes using the canonical RFC 4648 alphabet. */
export function bytesToBase64(value: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index]
    const second = value[index + 1]
    const third = value[index + 2]
    result += alphabet[first >> 2]
    result += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]
    result += second === undefined ? '=' : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]
    result += third === undefined ? '=' : alphabet[third & 63]
  }
  return result
}

/**
 * Decode canonical RFC 4648 Base64. An optional exact-size destination view is returned unchanged,
 * allowing the caller to materialize its final backing once, including an existing view prefix.
 */
export function base64ToBytes(value: string, target?: Uint8Array): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw encodingError(0)
  if (value.length % 4 !== 0) throw encodingError(value.length)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  /** The destination length is derived from validated text before any output write. */
  const length = (value.length / 4) * 3 - padding
  if (
    target !== undefined &&
    (!isUint8Array(target) || Reflect.get(typedArrayPrototype, 'byteLength', target) !== length)
  )
    throw attachErrorIdentity(
      new TypeError(
        UtilsErrorText.invalidArgument('target', 'a Uint8Array matching the decoded byte length')
      ),
      { source: '@migaia/utils', code: UtilsErrorCode.invalidArgument }
    )
  /** Default callers retain their existing one allocation; supplied targets allocate no backing. */
  const output = target ?? new Uint8Array(length)
  let outputOffset = 0
  for (let index = 0; index < value.length; index += 4) {
    const first = alphabet.indexOf(value[index])
    const second = alphabet.indexOf(value[index + 1])
    const third = value[index + 2] === '=' ? 0 : alphabet.indexOf(value[index + 2])
    const fourth = value[index + 3] === '=' ? 0 : alphabet.indexOf(value[index + 3])
    const thirdPadding = value[index + 2] === '='
    const fourthPadding = value[index + 3] === '='
    if ((thirdPadding && (second & 15) !== 0) || (fourthPadding && (third & 3) !== 0))
      throw encodingError(index)
    output[outputOffset++] = (first << 2) | (second >> 4)
    if (!thirdPadding) output[outputOffset++] = ((second & 15) << 4) | (third >> 2)
    if (!fourthPadding) output[outputOffset++] = ((third & 3) << 6) | fourth
  }
  return output
}

/** Encodes a byte sequence as canonical chunks with a bounded chunk size. */
export function* streamBase64Chunks(value: Uint8Array, maxChunkBytes = 32763): Iterable<string> {
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 3)
    throw new RangeError(UtilsErrorText.invalidArgument('maxChunkBytes', 'a safe integer >= 3'))
  const width = maxChunkBytes - (maxChunkBytes % 3)
  for (let offset = 0; offset < value.length; offset += width)
    yield bytesToBase64(value.subarray(offset, Math.min(offset + width, value.length)))
}

/**
 * Counts UTF-8 bytes without allocating a buffer or iterator. Lone UTF-16 surrogates count as the
 * three-byte U+FFFD replacement used by TextEncoder, so callers can check limits first.
 */
export function utf8ByteLength(value: string): number {
  /** Accumulated encoded size; counting must not allocate the eventual output. */
  let length = 0
  for (let index = 0; index < value.length;) {
    /** Normalized scalar value shared with the fallback encoder and chunker. */
    const codePoint = readUtf8CodePoint(value, index)
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    index += codePoint > 0xffff ? 2 : 1
  }
  return length
}

/** Encodes into a new byte array using the native encoder, or an equivalent loop when absent. */
export function encodeUtf8(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value)
  /** Exactly sized fallback output after the allocation-free count. */
  const output = new Uint8Array(utf8ByteLength(value))
  /** Next writable byte in the fallback output. */
  let offset = 0
  for (let index = 0; index < value.length;) {
    /** Normalized scalar value, including replacement of unpaired surrogates. */
    const codePoint = readUtf8CodePoint(value, index)
    index += codePoint > 0xffff ? 2 : 1
    if (codePoint <= 0x7f) output[offset++] = codePoint
    else if (codePoint <= 0x7ff) {
      output[offset++] = 0xc0 | (codePoint >> 6)
      output[offset++] = 0x80 | (codePoint & 0x3f)
    } else if (codePoint <= 0xffff) {
      output[offset++] = 0xe0 | (codePoint >> 12)
      output[offset++] = 0x80 | ((codePoint >> 6) & 0x3f)
      output[offset++] = 0x80 | (codePoint & 0x3f)
    } else {
      output[offset++] = 0xf0 | (codePoint >> 18)
      output[offset++] = 0x80 | ((codePoint >> 12) & 0x3f)
      output[offset++] = 0x80 | ((codePoint >> 6) & 0x3f)
      output[offset++] = 0x80 | (codePoint & 0x3f)
    }
  }
  return output
}

/** Decodes UTF-8 bytes using replacement or fatal mode. */
export function decodeUtf8(value: Uint8Array, options?: { readonly fatal?: boolean }): string {
  const fatal = options?.fatal ?? false
  let result = ''
  for (let offset = 0; offset < value.length;) {
    const start = offset
    const first = value[offset++]
    let codePoint: number | undefined
    const continuation = (count: number): number | undefined => {
      if (offset + count > value.length) return undefined
      let result = 0
      for (let index = 0; index < count; index++) {
        const byte = value[offset++]
        if ((byte & 0xc0) !== 0x80) return undefined
        result = (result << 6) | (byte & 0x3f)
      }
      return result
    }
    if (first <= 0x7f) codePoint = first
    else if (first >= 0xc2 && first <= 0xdf)
      codePoint = ((first & 0x1f) << 6) | (continuation(1) ?? -1)
    else if (first >= 0xe0 && first <= 0xef)
      codePoint = ((first & 0x0f) << 12) | (continuation(2) ?? -1)
    else if (first >= 0xf0 && first <= 0xf4)
      codePoint = ((first & 0x07) << 18) | (continuation(3) ?? -1)
    const minimum = first <= 0x7f ? 0 : first <= 0xdf ? 0x80 : first <= 0xef ? 0x800 : 0x10000
    if (
      codePoint === undefined ||
      codePoint < minimum ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      if (fatal) throw encodingError(start)
      offset = start + 1
      result += '\ufffd'
    } else result += String.fromCodePoint(codePoint)
  }
  return result
}

/** Splits normalized UTF-8 text within maxBytes without splitting a Unicode scalar value. */
export function splitUtf8(value: string, maxBytes: number): readonly string[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4)
    throw new RangeError(UtilsErrorText.invalidArgument('maxBytes', 'a safe integer >= 4'))
  if (value.length === 0) return ['']
  /** Completed chunks preserve input order and the existing empty-input special case. */
  const chunks: string[] = []
  /** Current normalized text chunk; lone surrogates become U+FFFD. */
  let chunk = ''
  /** Current chunk's encoded byte size. */
  let size = 0
  for (let index = 0; index < value.length;) {
    /** Next normalized scalar, read without creating a per-code-point iterator result. */
    const codePoint = readUtf8CodePoint(value, index)
    index += codePoint > 0xffff ? 2 : 1
    /** Encoded width determines whether this entire scalar belongs in the next chunk. */
    const width = codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    if (chunk && size + width > maxBytes) {
      chunks.push(chunk)
      chunk = ''
      size = 0
    }
    chunk += String.fromCodePoint(codePoint)
    size += width
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

/** Reads one scalar at a valid UTF-16 offset, replacing lone surrogates without allocation. */
function readUtf8CodePoint(value: string, index: number): number {
  /** Callers supply an in-range offset; the native scalar read joins only valid surrogate pairs. */
  const codePoint = value.codePointAt(index)!
  return codePoint >= 0xd800 && codePoint <= 0xdfff ? 0xfffd : codePoint
}

function encodingError(offset: number, cause?: unknown): TypeError {
  const error = new TypeError(UtilsErrorText.invalidEncoding('Base64', offset), { cause })
  Object.defineProperty(error, 'source', { value: '@migaia/utils', enumerable: true })
  Object.defineProperty(error, 'code', { value: UtilsErrorCode.invalidEncoding, enumerable: true })
  return error
}
