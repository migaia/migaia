import type {
  IOperationContext,
  IKeyRange,
  IStorageKey,
  IStorageIterator,
  ITransactionScope,
  IWriteConcurrencyOptions,
  ILockKey,
  IRecordQuery,
  IChainMethodsOf,
  ICodecStageObserver,
  IQueryStageObserver
} from '@migaia/storage-contract'
import type { IKeyValueStore, IStorageBase } from '@migaia/storage-contract'
import type { IStorageBorrowedBackend } from '../types.js'
/** Raw backends retain resource admission; only certified host views may omit ownership members. */
export type IEntityConnectStore = IKeyValueStore | IStorageBorrowedBackend<IStorageBase>
import type { ISchemaAdapter } from '../entity.js'
import type { IMigrationStep } from '@migaia/storage-contract'
import type { ICodec } from '../entity.js'
import type { IStorageInvalidRecordAction, IStorageRecordStage } from './constants.js'
import type { IObjectPathInput, IObjectPathValue } from '@migaia/utils/object'

/**
 * One backend-neutral secondary projection. Select a single path, a composite path tuple, or a
 * custom selector; query key types follow that choice.
 */
export type IEntityIndex<TDomain> =
  | {
      /** Domain property path whose value becomes the index key. */
      readonly path: IObjectPathInput<TDomain>
      /** Defaults to false; true rejects conflicting projected keys inside the authoritative commit. */
      readonly unique?: boolean
      /**
       * Defaults to false; true projects individual array elements and is unavailable for composite
       * paths.
       */
      readonly multiEntry?: boolean
      /**
       * Projection revision; path projections default to 1, while custom select must supply a
       * positive revision.
       */
      readonly revision?: number
    }
  | {
      /** Ordered domain paths forming one composite array key. */
      readonly paths: readonly IObjectPathInput<TDomain>[]
      /** Defaults to false; true rejects conflicting projected keys inside the authoritative commit. */
      readonly unique?: boolean
      /**
       * Defaults to false; true projects individual array elements and is unavailable for composite
       * paths.
       */
      readonly multiEntry?: false
      /**
       * Projection revision; path projections default to 1, while custom select must supply a
       * positive revision.
       */
      readonly revision?: number
    }
  | {
      /**
       * Synchronous projection returning a single key, multiple keys or undefined to omit this
       * record.
       */
      readonly select: (
        value: TDomain
      ) =>
        | { readonly kind: 'single'; readonly key: IStorageKey }
        | { readonly kind: 'multiple'; readonly keys: readonly IStorageKey[] }
        | undefined
      /** Defaults to false; true rejects conflicting projected keys inside the authoritative commit. */
      readonly unique?: boolean
      /**
       * Projection revision; path projections default to 1, while custom select must supply a
       * positive revision.
       */
      readonly revision: number
    }

type IEntityIndexDefinitions<TDomain> = Readonly<Record<string, IEntityIndex<TDomain>>>

type IEntityIndexQueryKey<TDomain, TIndex> = TIndex extends {
  readonly path: infer TPath
}
  ? TPath extends IObjectPathInput<TDomain>
    ? TIndex extends { readonly multiEntry: true }
      ? IObjectPathValue<TDomain, TPath> extends readonly (infer TElement)[]
        ? Extract<TElement, IStorageKey>
        : never
      : Extract<IObjectPathValue<TDomain, TPath>, IStorageKey>
    : never
  : TIndex extends { readonly paths: infer TPaths }
    ? TPaths extends readonly IObjectPathInput<TDomain>[]
      ? {
          readonly [TIndexPosition in keyof TPaths]: TPaths[TIndexPosition] extends IObjectPathInput<TDomain>
            ? Extract<IObjectPathValue<TDomain, TPaths[TIndexPosition]>, IStorageKey>
            : never
        }
      : never
    : TIndex extends {
          readonly select: (value: TDomain) => infer TProjection
        }
      ? TProjection extends { readonly kind: 'single'; readonly key: infer TKey }
        ? Extract<TKey, IStorageKey>
        : TProjection extends {
              readonly kind: 'multiple'
              readonly keys: readonly (infer TKey)[]
            }
          ? Extract<TKey, IStorageKey>
          : never
      : never

/** Compile-time query-key map derived from each declared index projection. */
export type IEntityIndexMap<
  TDomain,
  TIndexes extends IEntityIndexDefinitions<TDomain> = IEntityIndexDefinitions<TDomain>
> = Readonly<{
  [TName in keyof TIndexes & string]: IEntityIndexQueryKey<TDomain, TIndexes[TName]>
}>

/**
 * Reusable entity definition. Configuration is captured before connecting; backend capability
 * decides the default codec route.
 */
export type IEntityOptions<
  TDomain,
  TStored = TDomain,
  TIndexes extends IEntityIndexDefinitions<TDomain> | undefined = undefined
> = {
  /** Nonempty entity namespace; names beginning with the reserved __ prefix are rejected. */
  readonly name: string
  /** Names the domain object property used as its primary key. */
  readonly key: Extract<keyof TDomain, string>
  /** Defaults to `passthrough`, which returns values without validation. */
  readonly schema?: ISchemaAdapter<TDomain, TStored>
  /**
   * Applies on every backend through `selectCodec` using `store.capabilities`. Structured backends
   * do not bypass an explicitly configured codec. When omitted, IndexedDB and memory default to
   * `structuredCodec`, preserving objects through native structured cloning. Key-value-only
   * backends default to `jsonCodec`.
   */
  readonly codec?: ICodec<unknown, unknown>
  /** Positive safe-integer envelope version; defaults to 1. */
  readonly version?: number
  /**
   * Complete own step table from version 2 through the configured version; omitted only for version
   * 1.
   */
  readonly migrations?: Readonly<Record<number, IMigrationStep>>
  /**
   * Defaults to `true` because persisted data survives version changes, making invalid reads more
   * common than invalid writes.
   */
  readonly validateOnRead?: boolean
  /** Optional scan/fallback diagnostic receiver; omission uses the host console warning path. */
  readonly onDiagnostic?: (message: string) => void
  /** Optional default domain comparator; omission orders by the canonical primary key. */
  readonly defaultOrderBy?: IRecordComparator<TDomain>
  /** Secondary projections are entity-owned and backend-neutral. */
  readonly indexes?: TIndexes
}

/**
 * Compare two domain records using a finite numeric result; throwing or invalid output fails the
 * query with extension diagnostics.
 */
export type IRecordComparator<TRecord> = (left: TRecord, right: TRecord) => number

/**
 * Entity query controls. Filtering/order precede limit; structured backends can scan the entity
 * prefix while legacy/KV paths may require a full scan.
 */
/** Comparator ordering requires a finite result cap; ordinary canonical order may be unbounded. */
export type IEntityListOrder<TDomain> =
  | { readonly orderBy?: never; readonly limit?: number }
  | { readonly orderBy: IRecordComparator<TDomain>; readonly limit: number }

export type IListOptions<
  TRecord = unknown,
  TKey extends IStorageKey = IStorageKey
> = IEntityListOrder<TRecord> & {
  /**
   * V2 record keys isolate the entity first. Legacy records require a full-store scan until
   * explicit migration.
   */
  readonly range?: IKeyRange<TKey>
  /** Indexed queries use IIndexedListOptions so their index key remains correlated. */
  readonly index?: never
  /** Next by default, or prev for reverse key traversal. */
  readonly direction?: 'next' | 'prev'
  /**
   * Skip by default, throw to fail on an invalid record, or a synchronous handler returning either
   * action.
   */
  readonly onInvalid?: IInvalidRecordAction | IInvalidRecordHandler<TRecord>
}

/** Indexed list options reuse the repository query pipeline with an exact index key range. */
export type IIndexedListOptions<TRecord, TIndexes extends object> = {
  [TName in keyof TIndexes & string]: Omit<
    IListOptions<TRecord>,
    'range' | 'index' | 'orderBy' | 'limit'
  > &
    IEntityListOrder<TRecord> & {
      /** Exact declared index name whose projection determines the range key type. */
      readonly index: TName
      /** Optional range in the chosen index's projected key domain. */
      readonly range?: IKeyRange<TIndexes[TName] & IStorageKey>
    }
}[keyof TIndexes & string]

/** Separate index arguments preserve the same comparator/limit correlation. */
export type IEntityIndexOptions<TDomain> = Omit<
  IListOptions<TDomain>,
  'range' | 'orderBy' | 'limit'
> &
  IEntityListOrder<TDomain>

/** Skip a corrupt record or throw its failure; this policy does not repair stored data. */
export type IInvalidRecordAction = IStorageInvalidRecordAction
/** One invalid persisted record and the exact decode, migrate or validate phase that rejected it. */
export type IInvalidRecordIssue<TRecord = unknown> = {
  /** Logical record key associated with the failure. */
  readonly key: IStorageKey
  /** Original raw stored value inspected by this read. */
  readonly raw: unknown
  /** Materialized domain value when one was available before failure. */
  readonly record?: TRecord
  /** Decode, migrate or validate phase that failed. */
  readonly stage: IStorageRecordStage
  /** Original extension or decoding failure. */
  readonly cause: unknown
}
/**
 * Synchronous invalid-record policy returning skip or throw; invalid return values reject
 * configuration.
 */
export type IInvalidRecordHandler<TRecord = unknown> = (
  issue: IInvalidRecordIssue<TRecord>
) => IInvalidRecordAction

/** Explicit persisted-envelope upgrade options; reads alone never write migrated data back. */
export type IMigrateOptions<TRecord = unknown> = {
  /** Positive safe-integer persistence batch size; defaults to 100. */
  readonly batchSize?: number
  /** Skip by default, throw, or a synchronous per-record handler returning skip/throw. */
  readonly onInvalid?: IInvalidRecordAction | IInvalidRecordHandler<TRecord>
}

/**
 * Actual persisted migration counts, including skipped invalid records and unresolved concurrent
 * conflicts.
 */
export type IMigrateResult = {
  /** Physical candidate records examined. */
  readonly scanned: number
  /** Records admitted as candidates for this entity migration. */
  readonly eligible: number
  /** Records whose upgraded envelope was actually committed. */
  readonly migrated: number
  /** Invalid records skipped by the selected policy. */
  readonly skipped: number
  /** Records already at the current version when observed. */
  readonly alreadyCurrent: number
  /** Records still conflicting after the existing per-record retry path. */
  readonly conflicted: number
}

/** Existing selected query methods are read from the original storage cell at runtime. */
/** Only the actual connected store literal supplies the root change-feed fact. */
type IEntityStoreChangeFeed<S> = S extends { readonly capabilities: { readonly changeFeed: true } }
  ? true
  : false

export type IEntityStoreQueryMethods<S> = 'query' extends keyof IChainMethodsOf<S>
  ? NonNullable<IChainMethodsOf<S>['query']>
  : {}
/** Query sources are chosen first; filtering, projection and execution remain the shared core. */
export type IEntityQueryNarrowed<
  T,
  _TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  C extends IOperationContext | undefined = IOperationContext,
  A extends object = {}
> = IRecordQuery<T, C, A> & {
  onInvalid(
    action: IInvalidRecordAction | IInvalidRecordHandler<T>
  ): IEntityQueryNarrowed<T, _TIndexes, C, A>
}
/** The finite source adapter retains exact declared index names and key domains. */
export type IEntityQuery<
  T,
  X extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  C extends IOperationContext | undefined = IOperationContext,
  A extends object = {}
> = Omit<IRecordQuery<T, C, A>, 'where' | 'limit' | 'requirePushdown'> & {
  where: IRecordQuery<T, C, A>['where']
  index<N extends keyof X & string>(
    name: N,
    match?: X[N] | IKeyRange<X[N]>
  ): IEntityQueryNarrowed<T, X, C, A>
  range(range: IKeyRange): IEntityQueryNarrowed<T, X, C, A>
  onInvalid(
    action: IInvalidRecordAction | IInvalidRecordHandler<T>
  ): IEntityQueryNarrowed<T, X, C, A>
  limit(count: number): IEntityQueryNarrowed<T, X, C, A>
  requirePushdown(): IEntityQueryNarrowed<T, X, C, A>
}
/** Explicit observation ports are borrowed from the original installed host, without owning it. */
export type IEntityConnectOptions = Readonly<{
  codecStages?: ICodecStageObserver
  queryStages?: IQueryStageObserver
}>

/**
 * Entity operations bound to one structured-backend transaction. The scope expires with its
 * callback and cannot be retained.
 */
export type IEntityTransactionScope<
  TDomain,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {}
> = {
  query(): IEntityQuery<TDomain, TIndexes, undefined, TAugmentMethods>
  /** Read and materialize one entity value within this transaction. */
  get(id: IStorageKey): Promise<TDomain | undefined>
  /** Validate/normalize/encode and stage a value under its resulting primary key. */
  put(value: TDomain): Promise<IStorageKey>
  /** Stage deletion of the named entity record. */
  remove(id: IStorageKey): Promise<void>
  /** Read this transaction’s actual draft through the same repository materializer. */
  list(options?: IListOptions<TDomain> | IIndexedListOptions<TDomain, TIndexes>): Promise<TDomain[]>
}

/**
 * Entity-specific read/write/query view over one connected store. Disposal remains with the store
 * or Host owner.
 */
export type IRepository<
  TDomain,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  _TChangeFeed extends boolean = false,
  TAugmentMethods extends object = {}
> = {
  query(): IEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  /**
   * Read one domain value or undefined; older envelopes migrate in memory without implicit
   * writeback.
   */
  get(id: IStorageKey, ctx?: IOperationContext): Promise<TDomain | undefined>
  /** Validate/normalize/encode one value and commit it, returning the normalized primary key. */
  put(value: TDomain, ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<IStorageKey>
  /** Remove this entity's record for the supplied logical id. */
  remove(id: IStorageKey, ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  /**
   * Scans V2 structured records by their physical entity prefix and filters with the shared
   * comparator. Legacy records temporarily require a full-store scan.
   */
  list(
    options?: IListOptions<TDomain> | IIndexedListOptions<TDomain, TIndexes>,
    ctx?: IOperationContext
  ): Promise<TDomain[]>
  /** Iterate materialized query results; early return releases the iterator's operation resources. */
  stream(
    options?: IListOptions<TDomain> | IIndexedListOptions<TDomain, TIndexes>,
    ctx?: IOperationContext
  ): IStorageIterator<TDomain>
  /** Return the first matching domain value from a declared secondary projection. */
  findBy<TName extends keyof TIndexes & string>(
    index: TName,
    key: TIndexes[TName],
    ctx?: IOperationContext
  ): Promise<TDomain | undefined>
  /** Explicitly persist upgraded envelopes in bounded batches and return actual progress counts. */
  migrate(options?: IMigrateOptions<TDomain>, ctx?: IOperationContext): Promise<IMigrateResult>
  /**
   * Requires a structured backend with transaction rollback. Key-value-only backends throw
   * `UNSUPPORTED_CAPABILITY`.
   */
  batch<TResult>(
    run: (tx: IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>) => TResult,
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<Awaited<TResult>>
  /** Bind to the exact original owner without creating another native transaction. */
  in(tx: ITransactionScope): IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>
  /** Derive the actual physical record key used by this repository. */
  lockKey(id: IStorageKey): Extract<ILockKey, { readonly channel: 'text' | 'record' }>
}

/**
 * Frozen reusable entity description. Connecting creates a repository view without taking ownership
 * of its store.
 */
export type IEntityDefinition<
  TDomain,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>
> = {
  /** Captured entity namespace. */
  readonly name: string
  /** Captured positive envelope version. */
  readonly version: number
  /** Bind to one actual store, selecting a capability-compatible codec and query route. */
  connect<S extends IEntityConnectStore>(
    store: S,
    options?: IEntityConnectOptions
  ): IRepository<TDomain, TIndexes, IEntityStoreChangeFeed<S>, IEntityStoreQueryMethods<S>>
}
