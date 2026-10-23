import type {
  ICapabilityStore,
  ICapabilityImpl,
  IRecordStore,
  ITransactionScope,
  ITransactionBuilder,
  ITransactionOptions,
  IStorageResource,
  ISqlValue,
  ISqlRunResult,
  ISqlExecutor,
  IOperationContext,
  IRecordsApi,
  IConcurrencyPolicy,
  ILockHolding,
  ISyncCapableStore
} from '@migaia/storage-contract'
import { kv, records } from '@migaia/storage-contract'
/** SQLite columns exclude booleans; SQL inputs still accept booleans and bind them as integers. */
export type ISqliteValue = Exclude<ISqlValue, boolean>
/** Native dynamic rows preserve exact integers and copied binary values. */
export type ISqliteRow = Readonly<Record<string, ISqliteValue>>
/** Every SQLite mutation reports its native insertion identity. */
export type ISqliteRunResult = ISqlRunResult & { readonly lastInsertRowid: number | bigint }
/** Common SQL composition specializes only native rows and results. */
export type ISqliteExecutor = ISqlExecutor<ISqliteValue, ISqliteRunResult>
/** Trusted synchronous driver view is borrowed; it grants no close authority. */
export type ISqliteDriver = { exec(sql: string): void; prepare(sql: string): ISqliteStatement }
/** Bound statements finish synchronously and preserve native integer precision. */
export type ISqliteStatement = {
  run(...values: readonly ISqliteValue[]): ISqliteRunResult
  get(...values: readonly ISqliteValue[]): ISqliteRow | undefined
  all(...values: readonly ISqliteValue[]): readonly ISqliteRow[]
}
/** Creating callers alone own the native connection resource. */
export type ISqliteConnection = ISqliteDriver & IStorageResource
/** Only capabilities with actual published implementations appear in the current slice. */
export type ISqliteCapabilities = typeof kv | typeof records
/** Complete original scope retains the same connection's native SQL executor. */
export type ISqliteTransactionScope<TValue = unknown> = ITransactionScope<
  TValue,
  ISqliteCapabilities
> &
  ISqliteExecutor
/** Native methods remain available through the capability provider's exact store projection. */
export type ISqliteNativeStore<TValue> = Omit<
  ISyncCapableStore<IRecordStore<TValue>>,
  'transaction' | 'metadata'
> &
  Required<Pick<IRecordStore<TValue>, 'metadata'>> &
  ISqliteExecutor & {
    readonly backend: 'sqlite'
    inspectLocks(ctx?: IOperationContext): Promise<readonly ILockHolding[]>
    transaction<R>(
      run: (tx: ISqliteTransactionScope<TValue>) => R,
      options?: ITransactionOptions
    ): Promise<Awaited<R>>
    tx(): ITransactionBuilder<ISqliteTransactionScope<TValue>>
  }
/** Provider identity and exact record values survive host installation. */
export type ISqliteStore<TValue = unknown> = ICapabilityStore<
  ISqliteNativeStore<TValue>,
  ISqliteCapabilities,
  readonly [ICapabilityImpl<typeof kv>, ICapabilityImpl<typeof records, IRecordsApi<TValue>>]
>
/** Driver is exclusive to one store until that store has fully drained. */
export type ISqliteOptions = {
  readonly driver: ISqliteDriver
  readonly table?: string
  readonly concurrency?: IConcurrencyPolicy
  readonly owner?: { readonly label?: string }
  readonly maxLockMs?: number
  readonly wal?: boolean
}
/** Maintenance uses the original SQL endpoint and never owns another connection. */
export type ISqliteMaintenanceApi = {
  backup(path: string, ctx?: IOperationContext): Promise<void>
  vacuum(ctx?: IOperationContext): Promise<void>
}
