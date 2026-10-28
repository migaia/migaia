import { createCodecError } from './internal/codec.ts'
import { SerializeErrorCode } from './error-code.ts'
import { SERIALIZE_SOURCE } from './errors.ts'

/** Encoded carrier selected by a codec, independent of its business value type. */
export type ICodecEncodedType = 'unknown' | 'string' | 'uint8array'

/** Generic codec contract; callback properties preserve strict function variance. */
export type ICodec<
  TValue,
  TEncoded,
  TId extends string = string,
  TVersion extends number = number
> = Readonly<{
  /** Stable format identity, separate from parser registry plugin routing. */
  id: TId
  /** Explicit format revision; built-in factories require a positive safe integer. */
  version: TVersion
  /** Unknown preserves arbitrary values, string carries text, and uint8array carries binary frames. */
  encodedType: ICodecEncodedType
  /**
   * Synchronously converts a domain value to the declared representation; format failures are
   * thrown.
   */
  encode: (value: TValue) => TEncoded
  /**
   * Synchronously restores the codec's domain value; decoding does not imply original object
   * identity.
   */
  decode: (value: TEncoded) => TValue
}>

/**
 * Recursive portable value shape used by format codecs. Runtime validation additionally requires
 * finite numbers, supported record prototypes, dense arrays, no cycles, and valid reserved bytes
 * tags. The type alone does not prove these constraints or restore encoded bytes to Uint8Array.
 */
export type ICodecValue =
  | null
  | boolean
  | number
  | string
  | readonly ICodecValue[]
  | Readonly<{ [key: string]: ICodecValue }>

export { CodecErrorText } from './codec-text.ts'

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
} from './portable.ts'
export type { IPortableWalkerStrategy, IPortableBinaryResult } from './portable.ts'

/**
 * Returns an already serialize-owned Error unchanged, preserving its existing semantic code.
 * Otherwise builds a coded Error with the supplied message and exact original failure on cause;
 * format factories use it to avoid repeatedly wrapping a classified portable-value rejection.
 */
export function normalizeCodecFailure(
  error: unknown,
  code: (typeof SerializeErrorCode)[keyof typeof SerializeErrorCode],
  message: string
): Error {
  if (isSerializeCodecError(error)) return error
  return createCodecError(code, message, error)
}
