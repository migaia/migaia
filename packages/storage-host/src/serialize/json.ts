import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { fromValueCodec, type ICodec } from '@migaia/storage-contract'
import { StorageError, StorageErrorCode } from '../errors.js'

/** The original portable JSON implementation owns validation and value projection. */
const adaptedJson = fromValueCodec(defineJsonCodec({ version: 1 }))

/**
 * Strict portable JSON text route. Values outside the portable profile reject before backend I/O;
 * errors retain the contract adapter and original serialize failure on their cause chain.
 */
export const jsonCodec: ICodec<unknown, string> = Object.freeze({
  name: adaptedJson.name,
  output: adaptedJson.output,
  encode: async (value, context) => {
    try {
      return await adaptedJson.encode(value as Parameters<typeof adaptedJson.encode>[0], context)
    } catch (cause) {
      throw new StorageError(StorageErrorCode.serializeFailed, { cause })
    }
  },
  decode: async (raw, context) => {
    try {
      return await adaptedJson.decode(raw, context)
    } catch (cause) {
      throw new StorageError(StorageErrorCode.deserializeFailed, { cause })
    }
  }
})
