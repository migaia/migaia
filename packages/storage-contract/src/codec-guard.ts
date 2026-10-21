import { StorageContractError, StorageContractErrorCode } from './errors.js'
import type { ICodec } from './codec.js'
import { StorageContractErrorText } from './error-text.js'

/**
 * Reads a codec's name, output, encode, and decode once before capability-based routing. Accepts
 * non-array objects, including class instances, with a nonblank name, text/binary/structured
 * output, and two callable methods. Returns a new shallow descriptor, without running the methods
 * or capturing their original receiver; the result is not frozen. Malformed descriptors and
 * getter/reflection failures throw INVALID_ARGUMENT with cause retained.
 */
export const snapshotCodec = (codec: unknown): ICodec => {
  const candidate = codec as Record<string, unknown>
  let name: unknown
  let output: unknown
  let encode: unknown
  let decode: unknown
  try {
    if (typeof codec !== 'object' || codec === null || Array.isArray(codec))
      throw new TypeError(StorageContractErrorText.codecDescriptor)
    name = candidate.name
    output = candidate.output
    encode = candidate.encode
    decode = candidate.decode
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  if (
    typeof name !== 'string' ||
    name.trim() === '' ||
    !['text', 'binary', 'structured'].includes(output as string) ||
    typeof encode !== 'function' ||
    typeof decode !== 'function'
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.codecDescriptor)
    })
  return { name, output, encode, decode } as ICodec
}

/** Applies snapshotCodec's validation for type narrowing; returns void or throws INVALID_ARGUMENT. */
export function assertCodec(codec: unknown): asserts codec is ICodec {
  snapshotCodec(codec)
}
