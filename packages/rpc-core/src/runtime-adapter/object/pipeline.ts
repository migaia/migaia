import {
  isOutboundEnvelope,
  materializeOutboundJson
} from '../../core/internal/outbound-envelope.js'
import { SerializeErrorCode } from '@migaia/serialize/core'
import {
  asCodecValue,
  assertPortableValue,
  normalizeCodecFailure,
  CodecErrorText,
  type ICodec
} from '@migaia/serialize/codec'
import type { IRpcEnvelope, IRpcFramer } from '@migaia/rpc-contract'
import { remoteProcessStringFramer } from '@migaia/rpc-contract/framing'
import { createRuntimeBytePipeline } from '../byte/pipeline.js'

/** Exact canonical descriptor identities remain shared for each retained presentation contract. */
const pipelines = new Map<
  string,
  Readonly<{
    codec: ICodec<IRpcEnvelope, unknown>
    framer: IRpcFramer<unknown, unknown, string, number>
  }>
>()

/**
 * Materialize JSON's data-only view without revisiting caller getters or minting an owned receipt.
 * Object carriers use this ordinary data operation before delivering their existing listeners.
 */
export function materializeAdapterJson(value: unknown): unknown {
  return materializeOutboundJson(value)
}

/** Construct the canonical private object view paired with the Core-owned textual JSON pipeline. */
export function createRuntimeObjectPipeline(expectedStringText: string): Readonly<{
  codec: ICodec<IRpcEnvelope, unknown>
  framer: IRpcFramer<unknown, unknown, string, number>
}> {
  /** A second channel with the same diagnostic contract reuses the original component identities. */
  const existing = pipelines.get(expectedStringText)
  if (existing) return existing
  /** The same original textual codec supplies this paired object's public codec id and version. */
  const publicPipeline = createRuntimeBytePipeline(expectedStringText)
  /** Core-owned JSON materialization preserves the source codec's validation and error boundaries. */
  const codec: ICodec<IRpcEnvelope, unknown> = Object.freeze({
    id: publicPipeline.codec.id,
    version: publicPipeline.codec.version,
    encodedType: 'unknown',
    /** Preserve the original owned-envelope shortcut and source JSON codec failure normalization. */
    encode: (value) => {
      /** Only actual package construction allows skipping already-completed portable admission. */
      const owned = isOutboundEnvelope(value)
      /** Keep the original outer getter/portable admission outside the codec try boundary. */
      const admitted = owned ? value : asCodecValue(value)
      try {
        if (owned) return materializeOutboundJson(admitted)
        /** Admission accepts JSON-ready records; the private copy preserves their own-key order. */
        const portable = materializeAdapterJson(admitted)
        assertPortableValue(portable)
        return portable
      } catch (error) {
        throw normalizeCodecFailure(
          error,
          SerializeErrorCode.encodeFailed,
          CodecErrorText.encodeFailed
        )
      }
    },
    /** Keep received object admission on the original portable-value codec boundary. */
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
  const framer: IRpcFramer<unknown, unknown, string, number> = Object.freeze({
    id: remoteProcessStringFramer.id,
    version: remoteProcessStringFramer.version,
    inputEncodedType: 'unknown',
    outputEncodedType: 'unknown',
    frame: (value) => [value],
    accept: (value) => ({ status: 'complete' as const, value }),
    close: (reason) => remoteProcessStringFramer.close(reason)
  })
  /** One immutable pair is retained before any channel publishes its private object port. */
  const pipeline = Object.freeze({ codec, framer })
  pipelines.set(expectedStringText, pipeline)
  return pipeline
}
