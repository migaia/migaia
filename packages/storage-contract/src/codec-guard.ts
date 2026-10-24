import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { type ICodec } from './codec.js'
import { StorageContractErrorText } from './error-text.js'

/** Validates codec metadata and callable conversion ports without copying or running the codec. */
export function assertCodec(codec: unknown): asserts codec is ICodec {
  if (typeof codec !== 'object' || codec === null || Array.isArray(codec))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.codecDescriptor)
    })
  /** Ordinary descriptors can be class instances; only their public supported shape is required. */
  const candidate = codec as Record<string, unknown>
  if (
    typeof candidate.name !== 'string' ||
    candidate.name.trim() === '' ||
    !['text', 'binary', 'structured'].includes(candidate.output as string) ||
    typeof candidate.encode !== 'function' ||
    typeof candidate.decode !== 'function'
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageContractErrorText.codecDescriptor)
    })
}
