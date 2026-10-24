import { type IOperationContext } from '../context.js'
import { assertLockKey, type ILockKey, type IWriteConcurrencyOptions } from '../concurrency.js'
import { type IBackendKind } from '../capabilities.js'
import { StorageContractError, StorageContractErrorCode } from '../errors.js'
import { StorageContractErrorText } from '../error-text.js'
import { STORAGE_TTL_METHODS } from '../capability-constants.js'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.js'

/** TTL targets reuse exactly the physical lock channels that carry expiring values. */
export type ITtlTarget = Extract<
  ILockKey,
  { readonly channel: 'text' | 'bytes' | 'record' | 'vector' }
>

/** Root TTL operations share their backend's original key, write strategy and deadline state. */
export type ITtlApi = {
  expire(
    target: ITtlTarget,
    ms: number,
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<boolean>
  remaining(target: ITtlTarget, ctx?: IOperationContext): Promise<number | undefined>
  persist(target: ITtlTarget, ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<boolean>
}

/** Transaction TTL uses the current native draft and the transaction's original operation budget. */
export type ITransactionTtlApi = {
  expire(target: ITtlTarget, ms: number): Promise<boolean>
  remaining(target: ITtlTarget): Promise<number | undefined>
  persist(target: ITtlTarget): Promise<boolean>
}

/** Validate TTL's lock-domain subset without copying keys inside synchronous native terminals. */
export function assertStorageTtlTarget(
  target: unknown,
  backend: IBackendKind | undefined
): asserts target is ITtlTarget {
  assertLockKey(target, backend)
  if (target.channel === 'rdf')
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend },
      StorageContractErrorText.lockArgument
    )
}

/** Finite nonnegative durations include fractional milliseconds and immediate expiry at zero. */
export function assertStorageTtlDuration(ms: number, backend: IBackendKind | undefined): void {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0)
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend },
      StorageContractErrorText.ttlDuration
    )
}

/** Standard TTL publication requires all three native methods and its original transaction binder. */
export const ttl = /* @__PURE__ */ defineStandardStorageCapability<ITtlApi, 'ttl'>('ttl', {
  validate: (api) => validateCapabilityMethods(api, STORAGE_TTL_METHODS),
  transaction: { methods: STORAGE_TTL_METHODS }
})
