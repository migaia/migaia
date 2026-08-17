import { StorageError, StorageErrorCode } from '../types/errors.js';
import { isUint8Array } from '../core/bytes.js';
import type { ICodec } from './types.js';
import { StorageCodecOutput } from '../constants.js';

/** 调用方自带字节，走 setBytes 通道；遇 text-only 后端自动 base64 降级（体积 +33%）。 */
export const binaryCodec: ICodec<Uint8Array, Uint8Array> = Object.freeze({
  name: 'binary',
  output: StorageCodecOutput.binary,
  encode: async (value) => {
    if (!isUint8Array(value))
      throw new StorageError(StorageErrorCode.serializeFailed, {
        cause: new TypeError('binaryCodec.encode expects a Uint8Array')
      });
    return value;
  },
  decode: async (raw) => {
    if (!isUint8Array(raw))
      throw new StorageError(StorageErrorCode.deserializeFailed, {
        cause: new TypeError('binaryCodec.decode expects a Uint8Array')
      });
    return raw;
  }
});
