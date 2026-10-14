import type { ISerializeChunk, ISerializeParser, ISerializePlugin, ITextDecoder } from '../types.js'
import { createSerializeError, createSerializeTypeError, SerializeErrorCode } from '../errors.js'
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
      const encoded = JSON.stringify(value, replacer, space)
      if (encoded === undefined) {
        throw createSerializeTypeError(
          SerializeErrorCode.encodeFailed,
          'json parser cannot serialize this value'
        )
      }
      return ['text', encoded]
    },
    decode(chunk): unknown {
      if (chunk[0] === SerializeChunkKind.value) return chunk[1]
      if (chunk[0] === SerializeChunkKind.bytes) {
        const dec = decoder ?? hostTextDecoder()
        if (dec === undefined) {
          throw createSerializeError(
            SerializeErrorCode.envUnsupported,
            'TextDecoder is unavailable'
          )
        }
        return JSON.parse(dec.decode(chunk[1]), reviver)
      }
      return JSON.parse(chunk[1], reviver)
    }
  }
}

export const jsonPlugin = (options: IJsonPluginOptions = {}): ISerializePlugin => ({
  type: SerializePluginType.json,
  parser: jsonParser(options)
})
