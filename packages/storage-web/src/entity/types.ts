import type { IOperationContext, IKeyRange, IStorageKey } from '../types/context.js'
import type { IKeyValueStore } from '../types/storage.js'
import type { ISchemaAdapter } from '../schema/types.js'
import type { IMigration } from '../schema/migrate.js'
import type { ICodec } from '../serialize/types.js'
import type { IStorageInvalidRecordAction, IStorageRecordStage } from '../constants.js'
import type { IObjectPathInput, IObjectPathValue } from '@migaia/utils/object'

export type IEntityIndex<TDomain> =
  | {
      readonly path: IObjectPathInput<TDomain>
      readonly unique?: boolean
      readonly multiEntry?: boolean
      readonly revision?: number
    }
  | {
      readonly paths: readonly IObjectPathInput<TDomain>[]
      readonly unique?: boolean
      readonly multiEntry?: false
      readonly revision?: number
    }
  | {
      readonly select: (
        value: TDomain
      ) =>
        | { readonly kind: 'single'; readonly key: IStorageKey }
        | { readonly kind: 'multiple'; readonly keys: readonly IStorageKey[] }
        | undefined
      readonly unique?: boolean
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

export type IEntityOptions<
  TDomain,
  TStored = TDomain,
  TIndexes extends IEntityIndexDefinitions<TDomain> | undefined = undefined
> = {
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
  readonly version?: number
  readonly migrations?: Record<number, IMigration>
  /**
   * Defaults to `true` because persisted data survives version changes, making invalid reads more
   * common than invalid writes.
   */
  readonly validateOnRead?: boolean
  readonly onDiagnostic?: (message: string) => void
  readonly defaultOrderBy?: IRecordComparator<TDomain>
  /** Secondary projections are entity-owned and backend-neutral. */
  readonly indexes?: TIndexes
}

export type IRecordComparator<TRecord> = (left: TRecord, right: TRecord) => number

export type IListOptions<TRecord = unknown, TKey extends IStorageKey = IStorageKey> = {
  /**
   * V2 record keys isolate the entity first. Legacy records require a full-store scan until
   * explicit migration.
   */
  readonly range?: IKeyRange<TKey>
  /** Indexed queries use IIndexedListOptions so their index key remains correlated. */
  readonly index?: never
  readonly limit?: number
  readonly orderBy?: IRecordComparator<TRecord>
  readonly direction?: 'next' | 'prev'
  readonly onInvalid?: IInvalidRecordAction | IInvalidRecordHandler<TRecord>
}

/** Indexed list options reuse the repository query pipeline with an exact index key range. */
export type IIndexedListOptions<TRecord, TIndexes extends object> = {
  [TName in keyof TIndexes & string]: Omit<IListOptions<TRecord>, 'range' | 'index'> & {
    readonly index: TName
    readonly range?: IKeyRange<TIndexes[TName] & IStorageKey>
  }
}[keyof TIndexes & string]

export type IInvalidRecordAction = IStorageInvalidRecordAction
export type IInvalidRecordIssue<TRecord = unknown> = {
  readonly key: IStorageKey
  readonly raw: unknown
  readonly record?: TRecord
  readonly stage: IStorageRecordStage
  readonly cause: unknown
}
export type IInvalidRecordHandler<TRecord = unknown> = (
  issue: IInvalidRecordIssue<TRecord>
) => IInvalidRecordAction

export type IMigrateOptions<TRecord = unknown> = {
  readonly batchSize?: number
  readonly onInvalid?: IInvalidRecordAction | IInvalidRecordHandler<TRecord>
}

export type IMigrateResult = {
  readonly scanned: number
  readonly eligible: number
  readonly migrated: number
  readonly skipped: number
  readonly alreadyCurrent: number
  readonly conflicted: number
}

export type IEntityTransactionScope<TDomain> = {
  get(id: IStorageKey): Promise<TDomain | undefined>
  put(value: TDomain): Promise<IStorageKey>
  remove(id: IStorageKey): Promise<void>
}

export type IRepository<
  TDomain,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>
> = {
  get(id: IStorageKey, ctx?: IOperationContext): Promise<TDomain | undefined>
  put(value: TDomain, ctx?: IOperationContext): Promise<IStorageKey>
  remove(id: IStorageKey, ctx?: IOperationContext): Promise<void>
  /**
   * Scans V2 structured records by their physical entity prefix and filters with the shared
   * comparator. Legacy records temporarily require a full-store scan.
   */
  list(
    options?: IListOptions<TDomain> | IIndexedListOptions<TDomain, TIndexes>,
    ctx?: IOperationContext
  ): Promise<TDomain[]>
  stream(
    options?: IListOptions<TDomain> | IIndexedListOptions<TDomain, TIndexes>,
    ctx?: IOperationContext
  ): AsyncIterableIterator<TDomain>
  findBy<TName extends keyof TIndexes & string>(
    index: TName,
    key: TIndexes[TName],
    ctx?: IOperationContext
  ): Promise<TDomain | undefined>
  findManyBy<TName extends keyof TIndexes & string>(
    index: TName,
    range?: IKeyRange<TIndexes[TName]>,
    options?: Omit<IListOptions<TDomain>, 'range'>,
    ctx?: IOperationContext
  ): Promise<TDomain[]>
  streamBy<TName extends keyof TIndexes & string>(
    index: TName,
    range?: IKeyRange<TIndexes[TName]>,
    options?: Omit<IListOptions<TDomain>, 'range'>,
    ctx?: IOperationContext
  ): AsyncIterableIterator<TDomain>
  migrate(options?: IMigrateOptions<TDomain>, ctx?: IOperationContext): Promise<IMigrateResult>
  /**
   * Requires a structured backend with transaction rollback. Key-value-only backends throw
   * `UNSUPPORTED_CAPABILITY`.
   */
  batch<T>(
    run: (tx: IEntityTransactionScope<TDomain>) => Promise<T>,
    ctx?: IOperationContext
  ): Promise<T>
}

export type IEntityDefinition<
  TDomain,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>
> = {
  readonly name: string
  readonly version: number
  connect(store: IKeyValueStore): IRepository<TDomain, TIndexes>
}
