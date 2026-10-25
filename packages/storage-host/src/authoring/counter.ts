import {
  type IStorageCounterIncrement,
  type IBackendKind,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText
} from '@migaia/storage-contract'

/** Canonical decimal text excludes whitespace, exponents, leading zeroes and negative zero. */
const COUNTER_INTEGER = /^(?:0|-?[1-9][0-9]*)$/

/** Captures a valid delta before I/O and retains decimal/overflow validation in this same owner. */
export function snapshotStorageCounterIncrement(
  by: number | undefined,
  backend: IBackendKind | undefined
): IStorageCounterIncrement {
  /** Omission alone supplies the documented increment; all explicit values must be safe integers. */
  const delta = by === undefined ? 1 : by
  if (!Number.isSafeInteger(delta))
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend },
      StorageContractErrorText.counterIncrement
    )
  return (current) => {
    /** Reject malformed text without coercing an unsupported object or reading its valueOf. */
    const valid =
      current === null ||
      current === undefined ||
      (typeof current === 'string' && COUNTER_INTEGER.test(current))
    /** Only absent native text starts at zero; existing values must use the canonical spelling. */
    const value = valid ? (current === null || current === undefined ? 0 : Number(current)) : NaN
    /** The result is computed only after admission and cannot modify backend data on failure. */
    const result = value + delta
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(result))
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend },
        StorageContractErrorText.counterValue
      )
    return result
  }
}
