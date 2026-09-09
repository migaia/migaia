import { SerializeErrorCode } from '../error-code.js'
import {
  assertCodecVersion,
  asCodecValue,
  assertPortableValue,
  createCodecError,
  CodecErrorText,
  normalizeCodecFailure,
  toPortableValue,
  type ICodec,
  type ICodecValue
} from '../codec.js'

/** Options for the native JSON codec factory. */
export type IJsonCodecOptions<TVersion extends number> = Readonly<{ version: TVersion }>

/** Create a deterministic JSON codec for the portable profile. */
export function defineJsonCodec<const TVersion extends number>(
  options: IJsonCodecOptions<TVersion>
): ICodec<ICodecValue, string, 'json', TVersion> {
  const version = assertCodecVersion(options.version)
  return Object.freeze({
    id: 'json' as const,
    version,
    encodedType: 'string' as const,
    encode: (value: ICodecValue): string => {
      try {
        const portable = toPortableValue(value)
        assertPortableValue(portable)
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
