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
  /** 领域对象上作为主键的属性名。 */
  readonly key: Extract<keyof TDomain, string>
  /** 默认 passthrough：零校验直接透传。 */
  readonly schema?: ISchemaAdapter<TDomain, TStored>
  /**
   * 在所有后端上统一生效，经 selectCodec 按 store.capabilities 选路 （见 §7）——显式配置的 codec 不会被结构化后端绕过。未提供时按后端
   * 类型选默认值：结构化后端（IndexedDB/memory）默认 structuredCodec （原样存对象，利用原生 structured clone）；KV-only 后端默认
   * jsonCodec。
   */
  readonly codec?: ICodec<unknown, unknown>
  readonly version?: number
  readonly migrations?: Record<number, IMigration>
  /** 默认 true：持久化数据会跨版本存活，读到脏数据比写入脏数据更常见。 */
  readonly validateOnRead?: boolean
  readonly onDiagnostic?: (message: string) => void
  readonly defaultOrderBy?: IRecordComparator<TDomain>
  /** Secondary projections are entity-owned and backend-neutral. */
  readonly indexes?: TIndexes
}

export type IRecordComparator<TRecord> = (left: TRecord, right: TRecord) => number

export type IListOptions<TRecord = unknown, TKey extends IStorageKey = IStorageKey> = {
  /** V2 record key 先隔离 entity；legacy 兼容记录在显式 migrate 前仍需全库扫描。 */
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
  /** V2 结构化记录按 entity 物理前缀扫描并用共享 comparator 过滤；legacy 兼容记录会暂时走全库扫描。 */
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
  /** 仅结构化后端支持（有真正的事务回滚）；KV-only 后端抛 UNSUPPORTED_CAPABILITY。 */
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
