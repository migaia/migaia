import { UtilsErrorCode } from './error-code.js'
import { UtilsErrorText } from './error-text.js'

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

/** Decodes only canonical RFC 4648 Base64 text. */
export function base64ToBytes(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw encodingError(0)
  if (value.length % 4 !== 0) throw encodingError(value.length)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const output: number[] = []
  for (let index = 0; index < value.length; index += 4) {
    const first = alphabet.indexOf(value[index])
    const second = alphabet.indexOf(value[index + 1])
    const third = value[index + 2] === '=' ? 0 : alphabet.indexOf(value[index + 2])
    const fourth = value[index + 3] === '=' ? 0 : alphabet.indexOf(value[index + 3])
    output.push((first << 2) | (second >> 4))
    if (value[index + 2] !== '=') output.push(((second & 15) << 4) | (third >> 2))
    if (value[index + 3] !== '=') output.push(((third & 3) << 6) | fourth)
  }
  const result = new Uint8Array(output)
  if (bytesToBase64(result) !== value) throw encodingError(0)
  return result
}

/** Encodes a byte sequence as canonical chunks with a bounded chunk size. */
export function* streamBase64Chunks(value: Uint8Array, maxChunkBytes = 32763): Iterable<string> {
  if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 3)
    throw new RangeError(UtilsErrorText.invalidArgument('maxChunkBytes', 'a safe integer >= 3'))
  const width = maxChunkBytes - (maxChunkBytes % 3)
  for (let offset = 0; offset < value.length; offset += width)
    yield bytesToBase64(value.subarray(offset, Math.min(offset + width, value.length)))
}

/** Returns the UTF-8 byte length without allocating an encoded buffer. */
export function utf8ByteLength(value: string): number {
  let length = 0
  for (const codePoint of codePoints(value))
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
  return length
}

/** Encodes text as a newly allocated UTF-8 byte array. */
export function encodeUtf8(value: string): Uint8Array {
  const output = new Uint8Array(utf8ByteLength(value))
  let offset = 0
  for (const codePoint of codePoints(value)) {
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

/** Splits UTF-8 text into encoded chunks without exceeding maxBytes. */
export function splitUtf8(value: string, maxBytes: number): readonly string[] {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4)
    throw new RangeError(UtilsErrorText.invalidArgument('maxBytes', 'a safe integer >= 4'))
  if (value.length === 0) return ['']
  const chunks: string[] = []
  let chunk = ''
  let size = 0
  for (const codePoint of codePoints(value)) {
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

function* codePoints(value: string): Iterable<number> {
  for (let index = 0; index < value.length; index++) {
    const first = value.charCodeAt(index)
    if (first >= 0xd800 && first <= 0xdbff && index + 1 < value.length) {
      const second = value.charCodeAt(index + 1)
      if (second >= 0xdc00 && second <= 0xdfff) {
        index++
        yield 0x10000 + ((first - 0xd800) << 10) + second - 0xdc00
        continue
      }
    }
    yield first >= 0xd800 && first <= 0xdfff ? 0xfffd : first
  }
}

function encodingError(offset: number, cause?: unknown): TypeError {
  const error = new TypeError(UtilsErrorText.invalidEncoding('Base64', offset), { cause })
  Object.defineProperty(error, 'source', { value: '@migaia/utils', enumerable: true })
  Object.defineProperty(error, 'code', { value: UtilsErrorCode.invalidEncoding, enumerable: true })
  return error
}
