import {
  kv,
  records,
  ttl,
  counter,
  type ICapabilityStore,
  type ICapabilityImpl,
  type IRecordStore,
  type IRecordsApi,
  type ITextChangeFeedApi,
  type IConcurrencyPolicy,
  type ILockHolding,
  type IOperationContext,
  type ITransactionBuilder,
  type ITransactionScope,
  type ITransactionOptions
} from '@migaia/storage-contract'
import type { IRedisDriver } from './driver.js'

/** Only standard capabilities backed by the original native transaction owner appear on the base. */
export type IRedisCapabilities = typeof kv | typeof records | typeof ttl | typeof counter
/**
 * Original complete transaction scope retains every standard token without native Feature API
 * projection.
 */
export type IRedisTransactionScope = ITransactionScope<unknown, IRedisCapabilities>
/** Native facts describe the implemented Redis mapping, independently of optional server modules. */
export const redisCapabilities = Object.freeze({
  batch: true,
  syncRead: false,
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  secondaryIndexes: false,
  changeFeed: true,
  maxValueBytes: undefined,
  opaqueEntries: false
} as const)
/** Provider construction preserves the native transaction builder and exact capability identities. */
export type IRedisNativeStore = Omit<IRecordStore, 'transaction'> &
  ITextChangeFeedApi & {
    readonly backend: 'redis'
    readonly capabilities: typeof redisCapabilities
    inspectLocks(ctx?: IOperationContext): Promise<readonly ILockHolding[]>
    transaction<TResult>(
      run: (scope: IRedisTransactionScope) => TResult,
      ctx?: ITransactionOptions
    ): Promise<Awaited<TResult>>
    tx(): ITransactionBuilder<IRedisTransactionScope>
  }
/** Token APIs are implemented once and bound to the same native scope by the original provider. */
export type IRedisStore = ICapabilityStore<
  IRedisNativeStore,
  IRedisCapabilities,
  readonly [
    ICapabilityImpl<typeof kv>,
    ICapabilityImpl<typeof records, IRecordsApi<unknown, true>>,
    ICapabilityImpl<typeof ttl>,
    ICapabilityImpl<typeof counter>
  ]
>
/** A borrowed driver owns connection mechanics; this package owns only the Redis storage mapping. */
export type IRedisOptions = {
  readonly driver: IRedisDriver
  readonly prefix?: string
  readonly concurrency?: IConcurrencyPolicy
  readonly owner?: { readonly label?: string }
  readonly maxLockMs?: number
}
