import { StorageContractError, StorageContractErrorCode } from './errors.ts'
import { type ICodec } from './codec.ts'
import { StorageContractErrorText } from './error-text.ts'

/**
 * Validates codec metadata and that `encode`/`decode` are callable, without copying or running the
 * codec. It cannot check return values: the Promise-returning contract of {@link ICodec} remains the
 * codec author's responsibility, and a codec that returns plain values violates it even though it
 * passes this guard.
 */
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
