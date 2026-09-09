import { SerializeErrorCode } from './error-code.js'
import { SERIALIZE_SOURCE } from './errors.js'

/** Generic codec contract; callback properties preserve strict function variance. */
export type ICodec<
  TValue,
  TEncoded,
  TId extends string = string,
  TVersion extends number = number
> = Readonly<{
  id: TId
  version: TVersion
  encodedType: 'unknown' | 'string' | 'uint8array'
  encode: (value: TValue) => TEncoded
  decode: (value: TEncoded) => TValue
}>

/** Runtime-neutral portable input accepted by the built-in format codecs. */
export type ICodecValue =
  | null
  | boolean
  | number
  | string
  | readonly ICodecValue[]
  | Readonly<{ [key: string]: ICodecValue }>

/** The identity codec is exposed beside the generic contract without loading format runtimes. */
export { identityCodecV1 } from './codecs/identity.js'

/** Stable codec diagnostics shared by all format-specific implementations. */
export const CodecErrorText = {
  invalidVersion: 'serialize codec version must be a positive safe integer',
  invalidSchema: 'serialize protobuf schema descriptor is invalid',
  encodeFailed: 'serialize codec encode failed',
  decodeFailed: 'serialize codec decode failed',
  portableValueInvalid: 'serialize codec value is outside the portable profile'
} as const

/** Recognizes errors already normalized by this package so format failures stay wrapped once. */
function isSerializeCodecError(value: unknown): value is Error & {
  readonly source: string
  readonly code: string
} {
  return (
    value instanceof Error &&
    (value as { readonly source?: unknown }).source === SERIALIZE_SOURCE &&
    typeof (value as { readonly code?: unknown }).code === 'string'
  )
}

/** Construct a native error with package identity while retaining the original cause. */
export function createCodecError(
  code: (typeof SerializeErrorCode)[keyof typeof SerializeErrorCode],
  message: string,
  cause?: unknown
): Error {
  const error = new TypeError(message, cause === undefined ? undefined : { cause })
  Object.defineProperty(error, 'source', { value: SERIALIZE_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

/** Assert JSON-compatible portable data without importing the RPC contract package. */
export function assertPortableValue(value: unknown, active = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.portableValueInvalid)
  }
  if (typeof value !== 'object') {
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.portableValueInvalid)
  }
  if (active.has(value))
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.portableValueInvalid)
  active.add(value)
  const objectTag = ArrayBuffer.isView(value)
    ? (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag]
    : undefined
  if (
    value instanceof Uint8Array ||
    objectTag === 'Uint8Array' ||
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set
  )
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.portableValueInvalid)
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertPortableValue(item, active)
      return
    }
    let prototype: object | null
    try {
      prototype = Object.getPrototypeOf(value)
    } catch (error) {
      throw createCodecError(
        SerializeErrorCode.invalidOption,
        CodecErrorText.portableValueInvalid,
        error
      )
    }
    if (prototype !== Object.prototype && prototype !== null)
      throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.portableValueInvalid)
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.includes('$rpc')) {
      if (
        keys.length !== 2 ||
        record.$rpc !== 'bytes' ||
        typeof record.base64url !== 'string' ||
        !/^[A-Za-z0-9_-]*$/u.test(record.base64url)
      )
        throw createCodecError(
          SerializeErrorCode.invalidOption,
          CodecErrorText.portableValueInvalid
        )
      return
    }
    for (const key of keys) {
      assertPortableValue(record[key], active)
    }
  } finally {
    active.delete(value)
  }
}

/** Validate and narrow a decoded format value before it crosses the codec boundary. */
export function asCodecValue(value: unknown): ICodecValue {
  assertPortableValue(value)
  return value as ICodecValue
}

/** Converts runtime byte views to the portable tagged representation without host APIs. */
export function toPortableValue(value: unknown, active = new Set<object>()): unknown {
  if (value === null || typeof value !== 'object') return value
  const objectTag = ArrayBuffer.isView(value)
    ? (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag]
    : undefined
  if (value instanceof Uint8Array || objectTag === 'Uint8Array')
    return {
      $rpc: 'bytes',
      base64url: bytesToBase64url(
        value instanceof Uint8Array ? value : new Uint8Array(value as never)
      )
    }
  if (
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    (ArrayBuffer.isView(value) && objectTag !== 'Uint8Array')
  )
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.portableValueInvalid)
  if (active.has(value))
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.portableValueInvalid)
  active.add(value)
  const record = value as Record<string, unknown>
  if (Object.hasOwn(record, '$rpc')) {
    const result = Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, toPortableValue(record[key], active)])
    )
    active.delete(value)
    return result
  }
  const result = Array.isArray(value)
    ? value.map((item) => toPortableValue(item, active))
    : Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, toPortableValue((value as Record<string, unknown>)[key], active)])
      )
  active.delete(value)
  return result
}

/** Encodes bytes with the profile's unpadded base64url alphabet. */
function bytesToBase64url(value: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] ?? 0
    const second = value[index + 1]
    const third = value[index + 2]
    output += alphabet[first >> 2]
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]
    if (second !== undefined) output += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]
    if (third !== undefined) output += alphabet[third & 63]
  }
  return output.replaceAll('+', '-').replaceAll('/', '_')
}

/** Validate format version and retain its literal type for factory callers. */
export function assertCodecVersion<const TVersion extends number>(version: TVersion): TVersion {
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.invalidVersion)
  }
  return version
}

/** Wraps a format callback while retaining the package error code and original cause. */
export function normalizeCodecFailure(
  error: unknown,
  code: (typeof SerializeErrorCode)[keyof typeof SerializeErrorCode],
  message: string
): Error {
  if (isSerializeCodecError(error)) return error
  return createCodecError(code, message, error)
}
