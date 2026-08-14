import { StorageError, StorageErrorCode } from '../types/errors';
import type { ICodec } from './types';

/** 默认 codec：零依赖，全后端可用。 */
export const jsonCodec: ICodec<unknown, string> = Object.freeze({
  name: 'json',
  output: 'text',
  encode: async (value) => {
    try {
      return JSON.stringify(value) ?? 'null';
    } catch (cause) {
      throw new StorageError(StorageErrorCode.serializeFailed, { cause });
    }
  },
  decode: async (raw) => {
    try {
      return JSON.parse(raw);
    } catch (cause) {
      throw new StorageError(StorageErrorCode.deserializeFailed, { cause });
    }
  }
});
