import { StorageError, StorageErrorCode } from '../types/errors.js'
import type { ICodec } from './types.js'
import { StorageCodecOutput } from '../constants.js'

/**
 * Frozen JSON text codec delegating to JSON.stringify/JSON.parse. Undefined top-level encoding
 * becomes the text null; ordinary JSON loss/conversion rules still apply. Encode/decode failures
 * reject SERIALIZE_FAILED/DESERIALIZE_FAILED with the native cause. Entity repositories choose this
 * by default only for text backends.
 */
export const jsonCodec: ICodec<unknown, string> = Object.freeze({
  name: 'json',
  output: StorageCodecOutput.text,
  encode: async (value) => {
    try {
      return JSON.stringify(value) ?? 'null'
    } catch (cause) {
      throw new StorageError(StorageErrorCode.serializeFailed, { cause })
    }
  },
  decode: async (raw) => {
    try {
      return JSON.parse(raw)
    } catch (cause) {
      throw new StorageError(StorageErrorCode.deserializeFailed, { cause })
    }
  }
})
