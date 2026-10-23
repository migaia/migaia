import { isOutboundEnvelope } from '../../core/internal/outbound-envelope.js'
import { registerFastCodec, registerFastFramer } from '../../core/internal/fast-path.js'
import {
  readOwnedJsonSnapshot,
  prepareOwnedJsonSnapshot,
  RpcOwnedBinaryAlphabet
} from '../../core/internal/outbound-owned-codec.js'
import { SerializeErrorCode } from '@migaia/serialize/core'
import {
  asCodecValue,
  normalizeCodecFailure,
  CodecErrorText,
  type ICodec
} from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import {
  messageFramerV1,
  remoteProcessStringFramer as runtimeStringFramer
} from '@migaia/rpc-contract/framing'
import type { IRpcFramer } from '@migaia/rpc-contract'
import { asRuntimeString } from './diagnostics.js'
import type { IRuntimeByteViewFactory } from './event-byte-io.js'

/** The source codec remains the sole owner of JSON serialization and portable values. */
const jsonCodec = defineJsonCodec({ version: 1 })

/** Byte framing and JSON codec identities remain one immutable canonical component pair. */
type IRuntimeBytePipeline = Readonly<{
  codec: ICodec<unknown, unknown>
  framer: IRpcFramer<unknown, unknown, string, number>
}>

/** Exact diagnostic text shares generic descriptors without any later native resource upgrade. */
const pipelines = new Map<string, IRuntimeBytePipeline>()
/** Each actual byte-view resource owns separate canonical descriptors for its diagnostic text. */
const byteViewPipelines = new WeakMap<IRuntimeByteViewFactory, Map<string, IRuntimeBytePipeline>>()

/** Core constructs and signs the selected codec itself; caller text grants no codec proof. */
export function createRuntimeBytePipeline(
  expectedString: string,
  byteViewFactory?: IRuntimeByteViewFactory
): IRuntimeBytePipeline {
  /** Resource identity selects only descriptors Core constructed over those held operations. */
  let cache = pipelines
  if (byteViewFactory) {
    /** One native resource shares its original descriptors across actual connection replacements. */
    const retained = byteViewPipelines.get(byteViewFactory)
    cache = retained ?? new Map<string, IRuntimeBytePipeline>()
    if (!retained) byteViewPipelines.set(byteViewFactory, cache)
  }
  /** Sharing retains the original cross-carrier descriptor identity for the same public errors. */
  const existing = cache.get(expectedString)
  if (existing) return existing
  /** Remote's unknown-typed port validates input before delegating to the source codec. */
  const codec: ICodec<unknown, unknown> = Object.freeze({
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
    decode: (value) => jsonCodec.decode(asRuntimeString(value, expectedString))
  })

  // Registration keeps the public frozen descriptors intact and signs only their exact identities.
  /** A standard byte intrinsic is a callable resource; no runtime-name or public option selects it. */
  const nativeBase64 = Reflect.get(Uint8Array.prototype, 'toBase64') as unknown
  registerFastCodec(
    codec,
    byteViewFactory
      ? (bytes) =>
          byteViewFactory
            .from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
            .toString(RpcOwnedBinaryAlphabet)
      : typeof nativeBase64 === 'function'
        ? (bytes) =>
            Reflect.apply(nativeBase64, bytes, [
              { alphabet: RpcOwnedBinaryAlphabet, omitPadding: true }
            ]) as string
        : undefined,
    codec.decode
  )
  registerFastFramer(runtimeStringFramer)

  /** The byte pipeline keeps negotiated codec and exact string framing paired. */
  const pipeline: IRuntimeBytePipeline = Object.freeze({ codec, framer: runtimeStringFramer })

  cache.set(expectedString, pipeline)
  return pipeline
}

/** Message ports retain the existing identity codec and V1 whole-frame framer. */
export const runtimeMessagePipeline: Readonly<{
  codec: ICodec<unknown, unknown>
  framer: IRpcFramer<unknown, unknown, string, number>
}> = Object.freeze({ codec: identityCodec, framer: messageFramerV1 })
