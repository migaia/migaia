import { StorageContractError, StorageContractErrorCode } from './errors.js';
import type { ICodec } from './codec.js';

/** Read and validate a codec descriptor once so routing cannot observe changed accessors. */
export const snapshotCodec = (codec: unknown): ICodec => {
  if (typeof codec !== 'object' || codec === null || Array.isArray(codec))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('codec must declare name, output, encode, and decode')
    });
  const candidate = codec as Record<string, unknown>;
  let name: unknown;
  let output: unknown;
  let encode: unknown;
  let decode: unknown;
  try {
    name = candidate.name;
    output = candidate.output;
    encode = candidate.encode;
    decode = candidate.decode;
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause });
  }
  if (
    typeof name !== 'string' ||
    name.trim() === '' ||
    !['text', 'binary', 'structured'].includes(output as string) ||
    typeof encode !== 'function' ||
    typeof decode !== 'function'
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('codec must declare name, output, encode, and decode')
    });
  return { name, output, encode, decode } as ICodec;
};

/** Validate the common runtime codec descriptor before any capability routing. */
export function assertCodec(codec: unknown): asserts codec is ICodec {
  snapshotCodec(codec);
}
