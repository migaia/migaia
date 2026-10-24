import type {
  IStorageResource,
  IOperationContext,
  ISqlValue,
  ISqlRow,
  IRecordStore,
  ITransactionScope,
  ITransactionBuilder,
  ITransactionOptions,
  ICapabilityStore,
  ICapabilityImpl,
  IRecordsApi,
  ITtlApi,
  ICounterApi,
  ISqlExecutor,
  IConcurrencyPolicy,
  ILockHolding,
  ITextChangeFeedApi,
  IDurableStorageChange
} from '@migaia/storage-contract'
import { kv, records, ttl, counter, sql } from '@migaia/storage-contract'
import type { PgTruncatePolicy } from './constants.js'
/** Native results retain only the canonical SQL scalar domain. */
export type IPgResult = { readonly rows: readonly ISqlRow[]; readonly rowCount: number }
/** Native COPY uses only structured identifiers and a client-provided byte stream. */
export type IPgCopyTarget = {
  readonly table: readonly [string, ...string[]]
  readonly columns: readonly [string, ...string[]]
}
/** Native COPY options never permit server files or PROGRAM. */
export type IPgCopyOptions = {
  readonly format?: 'csv' | 'text'
  readonly header?: boolean
  readonly delimiter?: string
  readonly null?: string
}
/** Every real retry obtains a fresh source instead of replaying a consumed stream. */
export type IPgCopySource = () => AsyncIterable<Uint8Array>
/** One-dimensional native arrays stay in this package; public SQL keeps its scalar domain. */
export type IPgNativeArrayParameter =
  | { readonly arrayType: 'text'; readonly values: readonly (string | null)[] }
  | { readonly arrayType: 'float8'; readonly values: readonly (number | null)[] }
/** Native array carriers are encoded once and bound as a single engine parameter. */
export type IPgNativeParameter = ISqlValue | IPgNativeArrayParameter
/** A borrowed pool connection returns to its original pool only after real native settlement. */
export type IPgConnection = IStorageResource & {
  query(
    text: string,
    params: readonly IPgNativeParameter[],
    ctx?: IOperationContext
  ): Promise<IPgResult>
  copyFrom?(
    target: IPgCopyTarget,
    source: AsyncIterable<Uint8Array>,
    options: IPgCopyOptions,
    ctx?: IOperationContext
  ): Promise<void>
}
/** The pg adapter's original replication session owns acknowledgement and connection release. */
export type IPgLogicalReplicationRoute = {
  readonly schema: string
  readonly prefix: string
  readonly orgId?: string
}
/** A bounded native read reuses the same slot and original pgoutput decoder as the live stream. */
export type IPgLogicalReplicationPort = {
  detect(
    options: IPgLogicalReplicationOptions & IPgLogicalReplicationRoute,
    ctx?: IOperationContext
  ): Promise<IPgReplicationHealth>
  read(
    options: IPgLogicalReplicationOptions &
      IPgLogicalReplicationRoute & {
        readonly after?: string
        readonly limit?: number
      },
    ctx?: IOperationContext
  ): Promise<{ readonly changes: readonly IDurableStorageChange[]; readonly cursor: string }>
  open(
    options: IPgLogicalReplicationOptions &
      IPgLogicalReplicationRoute & {
        readonly from?: string
        readonly onChange: (change: IDurableStorageChange) => Promise<void>
        readonly onError?: (error: unknown) => void
      },
    ctx?: IOperationContext
  ): Promise<IStorageResource & { acknowledge(commitEndLsn: string): Promise<void> }>
  dropSlot(slot: string, ctx?: IOperationContext): Promise<void>
}
/** Deployment creates the persistent slot and FOR ALL TABLES publication before installation. */
export type IPgLogicalReplicationOptions = {
  readonly slot: string
  readonly publication: string
  /** Reset invalidates the complete route; block leaves a TRUNCATE commit unacknowledged. */
  readonly truncate?: PgTruncatePolicy
}
/** Decimal byte counts preserve PostgreSQL numeric precision for operational diagnostics. */
export type IPgReplicationHealth = {
  readonly maxSlotWalKeepSize: string
  readonly confirmedFlushLagBytes: string
  readonly retainedWalBytes: string
}
/** The injected driver remains caller-owned and deliberately exposes no close method. */
export type IPgDriver = {
  readonly logicalReplication?: IPgLogicalReplicationPort
  query(
    text: string,
    params: readonly IPgNativeParameter[],
    ctx?: IOperationContext
  ): Promise<IPgResult>
  connect(ctx?: IOperationContext): Promise<IPgConnection>
  listen?(
    channel: string,
    listener: (payload: string) => void,
    ctx?: IOperationContext
  ): Promise<IStorageResource>
}
/** Presets describe actual native server behavior rather than inferred compatible brands. */
export type IPgServer = 'postgres' | 'cockroach' | 'yugabyte'
/** The base store installs only these genuine standard implementations. */
export type IPgCapabilities = typeof kv | typeof records | typeof ttl | typeof counter | typeof sql
/** Native SQL and all standard methods share this exact original transaction scope. */
export type IPostgresTransactionScope<TValue = unknown> = ITransactionScope<
  TValue,
  IPgCapabilities
> &
  ISqlExecutor
/** Public native methods retain the exact preset and original host-owned lifetime. */
export type IPostgresNativeStore<TServer extends IPgServer, TValue> = Omit<
  IRecordStore<TValue>,
  'transaction' | 'tx' | 'metadata' | 'capabilities'
> &
  Required<Pick<IRecordStore<TValue>, 'metadata'>> &
  ISqlExecutor & {
    readonly backend: 'postgres'
    readonly capabilities: {
      readonly syncRead: false
      readonly binary: true
      readonly records: true
      readonly transactions: true
      readonly iteration: true
      readonly secondaryIndexes: false
      readonly changeFeed: TServer extends 'postgres' ? true : false
      readonly maxValueBytes: undefined
      readonly opaqueEntries: false
    }
    inspectLocks(ctx?: IOperationContext): Promise<readonly ILockHolding[]>
    transaction<R>(
      run: (scope: IPostgresTransactionScope<TValue>) => R,
      options?: ITransactionOptions
    ): Promise<Awaited<R>>
    tx(): ITransactionBuilder<IPostgresTransactionScope<TValue>>
  } & (TServer extends 'postgres' ? ITextChangeFeedApi : {})
/** Record watch is present only with the preset's real LISTEN source. */
type IPgRecordImplementation<TServer extends IPgServer, TValue> = TServer extends 'postgres'
  ? ICapabilityImpl<typeof records, IRecordsApi<TValue, true>>
  : ICapabilityImpl<typeof records, IRecordsApi<TValue>>
/** Provider projection preserves native methods and exact standard API shapes. */
export type IPostgresStore<
  TServer extends IPgServer = 'postgres',
  TValue = unknown
> = ICapabilityStore<
  IPostgresNativeStore<TServer, TValue>,
  IPgCapabilities,
  readonly [
    ICapabilityImpl<typeof kv>,
    IPgRecordImplementation<TServer, TValue>,
    ICapabilityImpl<typeof ttl, ITtlApi>,
    ICapabilityImpl<typeof counter, ICounterApi>,
    ICapabilityImpl<typeof sql>
  ]
>
/** Backend configuration borrows the actual driver without claiming its ownership. */
export type IPostgresOptions<TServer extends IPgServer = 'postgres'> = {
  readonly driver: IPgDriver
  readonly server?: TServer
  readonly schema?: string
  readonly prefix?: string
  readonly concurrency?: IConcurrencyPolicy
  readonly owner?: { readonly label?: string }
  readonly maxLockMs?: number
}
/** Native Features borrow the original operation/transaction endpoint without gaining registration. */
export type IPgNativeOperation = <R>(
  scope: IPostgresTransactionScope | undefined,
  operation: string,
  ctx: IOperationContext | undefined,
  run: (client: IPgConnection, context: IOperationContext | undefined) => Promise<R>
) => Promise<R>
/** Native notifications separate root subscription ownership from transaction-only publication. */
export type IPgListenApi = {
  listen(
    channel: string,
    listener: (payload: string) => void,
    ctx?: IOperationContext
  ): Promise<IStorageResource>
  notify(channel: string, payload: string, ctx?: IOperationContext): Promise<void>
}
/** A native scope never grants a LISTEN subscription outside its lifetime. */
export type IPgTransactionNotifyApi = {
  notify(channel: string, payload: string, ctx?: IOperationContext): Promise<void>
}
/** COPY sources are recreated only by the original transaction attempt. */
export type IPgCopyApi = {
  from(
    target: IPgCopyTarget,
    source: IPgCopySource,
    options?: IPgCopyOptions,
    ctx?: IOperationContext
  ): Promise<void>
}
/** Caller tables retain their own native SQL ID and JSONB payload semantics. */
export type IPgNativeVectorTarget = {
  readonly table: readonly [string, ...string[]]
  readonly idColumn: string
  readonly vectorColumn: string
  readonly payloadColumn?: string
}
/** Native planner knobs apply only inside the current original transaction. */
export type IPgNativeVectorSearchOptions = {
  readonly metric?: 'cosine' | 'dot' | 'euclid'
  readonly limit?: number
  readonly minScore?: number
  readonly filter?: import('@migaia/storage-contract').IVectorFilter
  readonly efSearch?: number
  readonly probes?: number
}
/** Native caller rows preserve their actual scalar domain instead of pretending standard point IDs. */
export type IPgNativeVectorHit = {
  readonly id: ISqlValue
  readonly score: number
  readonly payload?: ISqlValue
}
/** Caller-owned vector tables are never mirrored into managed collections. */
export type IPgNativeVectorApi = {
  search(
    target: IPgNativeVectorTarget,
    query: readonly number[],
    options?: IPgNativeVectorSearchOptions,
    ctx?: IOperationContext
  ): Promise<readonly IPgNativeVectorHit[]>
}
