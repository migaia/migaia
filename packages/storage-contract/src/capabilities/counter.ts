import type { IOperationContext } from '../context.js'
import type { IWriteConcurrencyOptions } from '../concurrency.js'
import type { IBackendKind } from '../capabilities.js'
import { StorageContractError, StorageContractErrorCode } from '../errors.js'
import { StorageContractErrorText } from '../error-text.js'
import { STORAGE_COUNTER_METHODS } from '../capability-constants.js'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.js'

/** Counters atomically update canonical decimal integers in the existing text channel. */
export type ICounterApi = {
  increment(
    key: string,
    by?: number,
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<number>
}
/** A transaction counter uses its original text draft and never opens a root operation. */
export type ITransactionCounterApi = { increment(key: string, by?: number): Promise<number> }
/** This pure calculation is applied only inside the backend's existing atomic text operation. */
export type IStorageCounterIncrement = (current: string | null | undefined) => number
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

/** Standard counter publication binds one native atomic increment in root and transaction views. */
export const counter = /* @__PURE__ */ defineStandardStorageCapability<ICounterApi, 'counter'>(
  'counter',
  {
    validate: (api) => validateCapabilityMethods(api, STORAGE_COUNTER_METHODS),
    transaction: { methods: STORAGE_COUNTER_METHODS }
  }
)
