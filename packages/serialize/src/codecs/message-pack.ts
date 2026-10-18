import { toCodecPortableValue } from '../portable.js'
import { decode, encode } from '@msgpack/msgpack'
import { SerializeErrorCode } from '../error-code.js'
import {
  asCodecValue,
  CodecErrorText,
  normalizeCodecFailure,
  type ICodec,
  type ICodecValue
} from '../codec.js'
import { assertCodecVersion } from '../internal/codec.js'

/** Options for the MessagePack codec factory. */
export type IMessagePackCodecOptions<TVersion extends number> = Readonly<{ version: TVersion }>

/** Create an extension-free MessagePack codec for portable values. */
export function defineMessagePackCodec<const TVersion extends number>(
  options: IMessagePackCodecOptions<TVersion>
): ICodec<ICodecValue, Uint8Array, 'message-pack', TVersion> {
  const version = assertCodecVersion(options.version)
  return Object.freeze({
    id: 'message-pack' as const,
    version,
    encodedType: 'uint8array' as const,
    encode: (value: ICodecValue): Uint8Array => {
      try {
        const portable = toCodecPortableValue(value)
        return encode(portable, { ignoreUndefined: true, sortKeys: true })
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
