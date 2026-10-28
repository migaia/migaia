import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { isUint8Array } from '@migaia/utils/bytes'
import { StorageErrorText } from '../error-text.ts'
import type { ICodec } from './types.ts'
import { StorageCodecOutput, EntityAdapterName } from '../adapter-constants.ts'

/**
 * Frozen Uint8Array codec retaining the original valid view on encode/decode; invalid values reject
 * SERIALIZE_FAILED or DESERIALIZE_FAILED. Backend writes own their byte snapshot. selectCodec adds
 * base64 wrapping on text-only backends, whose encoded length is four times ceil(byteLength / 3).
 */
export const binaryCodec: ICodec<Uint8Array, Uint8Array> = Object.freeze({
  name: EntityAdapterName.binary,
  output: StorageCodecOutput.binary,
  encode: async (value) => {
    if (!isUint8Array(value))
      throw new StorageError(StorageHostErrorCode.serializeFailed, {
        cause: new TypeError(StorageErrorText.binaryCodecEncode)
      })
    return value
  },
  decode: async (raw) => {
    if (!isUint8Array(raw))
      throw new StorageError(StorageHostErrorCode.deserializeFailed, {
        cause: new TypeError(StorageErrorText.binaryCodecDecode)
      })
    return raw
  }
})
