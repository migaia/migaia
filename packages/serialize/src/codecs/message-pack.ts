import { toCodecPortableValue } from '../portable.ts'
import { decode, encode } from '@msgpack/msgpack'
import { SerializeErrorCode } from '../error-code.ts'
import {
  asCodecValue,
  CodecErrorText,
  normalizeCodecFailure,
  type ICodec,
  type ICodecValue
} from '../codec.ts'
import { assertCodecVersion } from '../internal/codec.ts'

/** Options for the MessagePack codec factory. */
export type IMessagePackCodecOptions<TVersion extends number> = Readonly<{
  /** Required positive safe integer revision, independent of the peer library version. */
  version: TVersion
}>

/**
 * Creates a frozen synchronous message-pack codec using the optional MessagePack peer imported by
 * this subpath. Version is required and must be a positive safe integer. Encoding normalizes
 * portable values in property enumeration order without format extensions; decoding validates the
 * result and leaves inline bytes tags as records. Classified portable errors retain their code;
 * other encode/decode failures are coded with the original cause.
 */
export function defineMessagePackCodec<const TVersion extends number>(
  options: IMessagePackCodecOptions<TVersion>
): ICodec<ICodecValue, Uint8Array, 'message-pack', TVersion> & {
  readonly encodedType: 'uint8array'
} {
  /** Retain the admitted literal codec revision without rereading the caller option. */
  const version = assertCodecVersion(options.version)
  return Object.freeze({
    id: 'message-pack' as const,
    version,
    encodedType: 'uint8array' as const,
    encode: (value: ICodecValue): Uint8Array => {
      try {
        /** One shared projection owns value-domain validation before format encoding. */
        const portable = toCodecPortableValue(value)
        return encode(portable, { ignoreUndefined: true, sortKeys: false })
      } catch (error) {
        throw normalizeCodecFailure(
          error,
          SerializeErrorCode.encodeFailed,
          CodecErrorText.encodeFailed
        )
      }
    },
    decode: (value: Uint8Array): ICodecValue => {
      try {
        /** Validate the format decoder result through the shared portable value boundary. */
        const decoded = decode(value) as unknown
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
