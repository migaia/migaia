import { toCodecPortableValue } from '../portable.ts'
import { SerializeErrorCode } from '../error-code.ts'
import {
  asCodecValue,
  CodecErrorText,
  normalizeCodecFailure,
  type ICodec,
  type ICodecValue
} from '../codec.ts'
import { assertCodecVersion, createCodecError } from '../internal/codec.ts'

/** Options for the native JSON codec factory. */
export type IJsonCodecOptions<TVersion extends number> = Readonly<{
  /** Required positive safe integer revision; no default version is inserted. */
  version: TVersion
}>

/**
 * Creates a frozen synchronous json codec with the required positive safe-integer revision.
 * Encoding projects record keys in property order and inline bytes tags, then rejects values
 * outside the portable profile rather than silently dropping them. Decoding validates parsed values
 * without reviving bytes tags. Portable failures retain INVALID_OPTION; other format failures carry
 * ENCODE_FAILED or DECODE_FAILED with their original cause. No optional format peer is imported.
 */
export function defineJsonCodec<const TVersion extends number>(
  options: IJsonCodecOptions<TVersion>
): ICodec<ICodecValue, string, 'json', TVersion> & { readonly encodedType: 'string' } {
  const version = assertCodecVersion(options.version)
  return Object.freeze({
    id: 'json' as const,
    version,
    encodedType: 'string' as const,
    encode: (value: ICodecValue): string => {
      try {
        const portable = toCodecPortableValue(value)
        const encoded = JSON.stringify(portable)
        if (encoded === undefined)
          throw createCodecError(SerializeErrorCode.encodeFailed, CodecErrorText.encodeFailed)
        return encoded
      } catch (error) {
        throw normalizeCodecFailure(
          error,
          SerializeErrorCode.encodeFailed,
          CodecErrorText.encodeFailed
        )
      }
    },
    decode: (value: string): ICodecValue => {
      try {
        const decoded = JSON.parse(value) as unknown
        return asCodecValue(decoded)
      } catch (error) {
        throw normalizeCodecFailure(
          error,
          SerializeErrorCode.decodeFailed,
          CodecErrorText.decodeFailed
        )
      }
    }
  })
}
