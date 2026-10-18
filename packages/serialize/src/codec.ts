import { createCodecError } from './internal/codec.js'
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

export {
  createPortableWalker,
  toPortableValue,
  assertPortableValue,
  asCodecValue
} from './portable.js'
export type { IPortableWalkerStrategy, IPortableBinaryResult } from './portable.js'

/** Wraps a format callback while retaining the package error code and original cause. */
export function normalizeCodecFailure(
  error: unknown,
  code: (typeof SerializeErrorCode)[keyof typeof SerializeErrorCode],
  message: string
): Error {
  if (isSerializeCodecError(error)) return error
  return createCodecError(code, message, error)
}
