import {
  isOutboundEnvelope,
  materializeOutboundJson
} from '../../core/internal/outbound-envelope.js'
import { SerializeErrorCode } from '@migaia/serialize/core'
import {
  asCodecValue,
  assertPortableValue,
  toPortableValue,
  normalizeCodecFailure,
  CodecErrorText,
  type ICodec
} from '@migaia/serialize/codec'
import type { IRpcEnvelope, IRpcFramer } from '../../contract/index.js'
import { remoteProcessJsonCodec } from '../../process/pipeline.js'
import { remoteProcessStringFramer } from '../../process/string-framer.js'

/**
 * Copies already validated data-only snapshots as JSON.parse(JSON.stringify()) would materialize
 * them. It never revisits original user accessors and preserves this stage's own key order.
 */
export function materializeJsonSnapshot(value: unknown): unknown {
  return materializeOutboundJson(value, false)
}

/** Private JSON materialization preserves the source codec's validation and error boundaries. */
export const jsonObjectCodec: ICodec<IRpcEnvelope, unknown> = Object.freeze({
  id: remoteProcessJsonCodec.id,
  version: remoteProcessJsonCodec.version,
  encodedType: 'unknown',
  encode: (value) => {
    /** Only actual package construction allows skipping already-completed portable admission. */
    const owned = isOutboundEnvelope(value)
    // remoteProcessJsonCodec's outer admission is deliberately outside the source codec's try.
    /** Keep the original outer getter/portable admission outside the codec try boundary. */
    const admitted = owned ? value : asCodecValue(value)
    try {
      if (owned) return materializeOutboundJson(admitted)
      /** Source codec owns outgoing sorting and the fresh validated data-only tree. */
      const portable = toPortableValue(admitted)
      assertPortableValue(portable)
      return materializeJsonSnapshot(portable)
    } catch (error) {
      throw normalizeCodecFailure(
        error,
        SerializeErrorCode.encodeFailed,
        CodecErrorText.encodeFailed
      )
    }
  },
  decode: (value) => {
    try {
      return asCodecValue(value) as unknown as IRpcEnvelope
    } catch (error) {
      throw normalizeCodecFailure(
        error,
        SerializeErrorCode.decodeFailed,
        CodecErrorText.decodeFailed
      )
    }
  }
})

/** The private whole-envelope port retains the existing framer identity and close semantics. */
export const jsonObjectFramer: IRpcFramer<unknown, unknown, string, number> = Object.freeze({
  id: remoteProcessStringFramer.id,
  version: remoteProcessStringFramer.version,
  inputEncodedType: 'unknown',
  outputEncodedType: 'unknown',
  frame: (value) => [value],
  accept: (value) => ({ status: 'complete' as const, value }),
  close: (reason) => remoteProcessStringFramer.close(reason)
})
