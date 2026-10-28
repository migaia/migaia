import type { ISerializeChunk, ISerializeParser, ISerializePlugin, ITextDecoder } from '../types.ts'
import {
  createSerializeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText,
  tagSerializeFailure,
  SERIALIZE_SOURCE
} from '../errors.ts'
import { SerializeChunkKind, SerializePluginType } from '../format-constants.ts'

/** Native JSON callback and text-decoding options, captured when a parser is created. */
export type IJsonPluginOptions = {
  /** Optional JSON.stringify replacer, default undefined; owns any application-specific projection. */
  readonly replacer?: (key: string, value: unknown) => unknown
  /** Optional JSON.parse reviver, default undefined; restoration policy belongs to this callback. */
  readonly reviver?: (key: string, value: unknown) => unknown
  /** Optional JSON.stringify indentation, default undefined; native JSON spacing rules apply. */
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
 * Creates a synchronous parser delegating to host JSON.stringify/JSON.parse, with options
 * defaulting to an empty record. Encoding returns one text chunk and follows native JSON projection
 * rules, without portable-codec validation. Decode passes value chunks through unchanged, parses
 * text, or uses an injected/host decoder for bytes. Missing byte-decoding capability throws
 * ENV_UNSUPPORTED; encode/parse failures retain coded native errors and original causes.
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

/**
 * Creates a fresh json routing plugin and parser; options default to the native JSON parser
 * defaults.
 */
export const jsonPlugin = (options: IJsonPluginOptions = {}): ISerializePlugin => ({
  type: SerializePluginType.json,
  parser: jsonParser(options)
})
