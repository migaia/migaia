import { asCodecValue, type ICodec } from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { messageFramerV1 } from '../contract/framing/message-framer.js'
import type { IRpcFramer } from '../contract/types.js'
import { asProcessString, remoteProcessStringFramer } from './string-framer.js'

/** The source codec remains the sole owner of JSON serialization and portable values. */
const jsonCodec = defineJsonCodec({ version: 1 })

/** Remote's unknown-typed port validates input before delegating to the source codec. */
export const remoteProcessJsonCodec: ICodec<unknown, unknown> = Object.freeze({
  id: jsonCodec.id,
  version: jsonCodec.version,
  encodedType: jsonCodec.encodedType,
  encode: (value) => jsonCodec.encode(asCodecValue(value)),
  decode: (value) => jsonCodec.decode(asProcessString(value))
})

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
