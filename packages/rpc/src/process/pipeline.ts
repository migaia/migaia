import { isOutboundEnvelope } from '../core/internal/outbound-envelope.js'
import { registerFastCodec, registerFastFramer } from '../core/internal/fast-path.js'
import {
  readOwnedJsonSnapshot,
  prepareOwnedJsonSnapshot,
  RpcOwnedBinaryAlphabet
} from '../core/internal/outbound-owned-codec.js'
import { SerializeErrorCode } from '@migaia/serialize/core'
import {
  asCodecValue,
  normalizeCodecFailure,
  CodecErrorText,
  type ICodec
} from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { messageFramerV1 } from '../contract/framing/index.js'
import type { IRpcFramer } from '../contract/index.js'
import { asProcessString, remoteProcessStringFramer } from './string-framer.js'

/** The source codec remains the sole owner of JSON serialization and portable values. */
const jsonCodec = defineJsonCodec({ version: 1 })

/** Remote's unknown-typed port validates input before delegating to the source codec. */
export const remoteProcessJsonCodec: ICodec<unknown, unknown> = Object.freeze({
  id: jsonCodec.id,
  version: jsonCodec.version,
  encodedType: jsonCodec.encodedType,
  encode: (value) => {
    /** Only the original sender can retain a complete immutable JSON view for this exact source. */
    const prepared = readOwnedJsonSnapshot(value)
    if (prepared) {
      try {
        return JSON.stringify(prepared.value)
      } catch (error) {
        throw normalizeCodecFailure(
          error,
          SerializeErrorCode.encodeFailed,
          CodecErrorText.encodeFailed
        )
      }
    }
    if (!isOutboundEnvelope(value)) return jsonCodec.encode(asCodecValue(value))
    try {
      return JSON.stringify(prepareOwnedJsonSnapshot(value).value)
    } catch (error) {
      // Retain the source JSON codec's native failure/cause boundary even on owned snapshots.
      throw normalizeCodecFailure(
        error,
        SerializeErrorCode.encodeFailed,
        CodecErrorText.encodeFailed
      )
    }
  },
  decode: (value) => jsonCodec.decode(asProcessString(value))
})

// Registration keeps the public frozen descriptors intact and signs only their exact identities.
/** A standard byte intrinsic is a callable resource; no runtime-name or public option selects it. */
const nativeBase64 = Reflect.get(Uint8Array.prototype, 'toBase64') as unknown
registerFastCodec(
  remoteProcessJsonCodec,
  typeof nativeBase64 === 'function'
    ? (bytes) =>
        Reflect.apply(nativeBase64, bytes, [
          { alphabet: RpcOwnedBinaryAlphabet, omitPadding: true }
        ]) as string
    : undefined
)
registerFastFramer(remoteProcessStringFramer)

/** The byte pipeline keeps negotiated codec and exact string framing paired. */
export const byteProcessPipeline: Readonly<{
  codec: ICodec<unknown, unknown>
  framer: IRpcFramer<unknown, unknown, string, number>
}> = Object.freeze({ codec: remoteProcessJsonCodec, framer: remoteProcessStringFramer })

/** Message ports retain the existing identity codec and V1 whole-frame framer. */
export const messageProcessPipeline: Readonly<{
  codec: ICodec<unknown, unknown>
  framer: IRpcFramer<unknown, unknown, string, number>
}> = Object.freeze({ codec: identityCodecV1, framer: messageFramerV1 })
