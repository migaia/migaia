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

import { CodecErrorText } from './codec-text.js'
export { CodecErrorText } from './codec-text.js'

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

export {
  createPortableWalker,
  toPortableValue,
  assertPortableValue,
  asCodecValue
} from './portable.js'
export type { IPortableWalkerStrategy, IPortableBinaryResult } from './portable.js'

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
