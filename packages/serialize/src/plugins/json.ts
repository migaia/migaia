import type { ISerializeChunk, ISerializeParser, ISerializePlugin, ITextDecoder } from '../types.js'
import {
  createSerializeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText,
  tagSerializeFailure,
  SERIALIZE_SOURCE
} from '../errors.js'
import { SerializeChunkKind, SerializePluginType } from '../format-constants.js'

export type IJsonPluginOptions = {
  /** Passed to `JSON.stringify` to omit fields that cannot be serialized. */
  readonly replacer?: (key: string, value: unknown) => unknown
  /** Passed to `JSON.parse` to restore rich values such as dates. */
  readonly reviver?: (key: string, value: unknown) => unknown
  /** Debug indentation. Omit in production to avoid increasing payload size. */
  readonly space?: number
  /**
   * Injected byte decoder. Defaults to the host `TextDecoder`, explicitly relying on the Encoding
   * API.
   */
  readonly decoder?: ITextDecoder
}

const hostTextDecoder = (): ITextDecoder | undefined => {
  const Ctor = (globalThis as { TextDecoder?: new () => ITextDecoder }).TextDecoder
  return Ctor ? new Ctor() : undefined
}

/**
 * Default JSON parser using V8's optimized native JSON implementation. Earlier measurements
 * identify JSON as the fastest tested path when consumers require a main-thread object graph. Use
 * another parser for byte passthrough or a format that JSON cannot represent.
 */
export function jsonParser(options: IJsonPluginOptions = {}): ISerializeParser {
  const { replacer, reviver, space, decoder } = options
  return {
    name: SerializePluginType.json,
    encode(value): ISerializeChunk {
      /** Preserve native stringify failures and user callback identity at the standalone boundary. */
      let encoded: string | undefined
      try {
        encoded = JSON.stringify(value, replacer, space)
      } catch (error) {
        throw tagSerializeFailure(
          error,
          SerializeErrorCode.encodeFailed,
          SerializeErrorText.jsonEncodeFailed
        )
      }
      if (encoded === undefined) {
        throw createSerializeTypeError(
          SerializeErrorCode.encodeFailed,
          SerializeErrorText.jsonUndefined
        )
      }
      return ['text', encoded]
    },
    decode(chunk): unknown {
      if (chunk[0] === SerializeChunkKind.value) return chunk[1]
      try {
        if (chunk[0] === SerializeChunkKind.bytes) {
          const dec = decoder ?? hostTextDecoder()
          if (dec === undefined) {
            throw createSerializeError(
              SerializeErrorCode.envUnsupported,
              SerializeErrorText.jsonDecoderUnavailable
            )
          }
          return JSON.parse(dec.decode(chunk[1]), reviver)
        }
        return JSON.parse(chunk[1], reviver)
      } catch (error) {
        // Already-owned capability failures keep their existing code.
        if (
          error instanceof Error &&
          (error as { source?: unknown }).source === SERIALIZE_SOURCE &&
          (error as { code?: unknown }).code === SerializeErrorCode.envUnsupported
        )
          throw error
        throw tagSerializeFailure(
          error,
          SerializeErrorCode.decodeFailed,
          SerializeErrorText.jsonDecodeFailed
        )
      }
    }
  }
}

export const jsonPlugin = (options: IJsonPluginOptions = {}): ISerializePlugin => ({
  type: SerializePluginType.json,
  parser: jsonParser(options)
})
