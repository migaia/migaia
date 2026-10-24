import { type IOperationContext } from '../context.js'
import { type IWriteConcurrencyOptions } from '../concurrency.js'
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

/** Standard counter publication binds one native atomic increment in root and transaction views. */
export const counter = /* @__PURE__ */ defineStandardStorageCapability<ICounterApi, 'counter'>(
  'counter',
  {
    validate: (api) => validateCapabilityMethods(api, STORAGE_COUNTER_METHODS),
    transaction: { methods: STORAGE_COUNTER_METHODS }
  }
)
