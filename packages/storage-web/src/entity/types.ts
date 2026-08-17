import type { IOperationContext, IKeyRange, IStorageKey } from '../types/context.js';
import type { IKeyValueStore } from '../types/storage.js';
import type { ISchemaAdapter } from '../schema/types.js';
import type { IMigration } from '../schema/migrate.js';
import type { ICodec } from '../serialize/types.js';
import type { IStorageInvalidRecordAction, IStorageRecordStage } from '../constants.js';

export type IEntityOptions<TDomain, TStored = TDomain> = {
  readonly name: string;
  /** 领域对象上作为主键的属性名。 */
  readonly key: Extract<keyof TDomain, string>;
  /** 默认 passthrough：零校验直接透传。 */
  readonly schema?: ISchemaAdapter<TDomain, TStored>;
  /**
   * 在所有后端上统一生效，经 selectCodec 按 store.capabilities 选路 （见 §7）——显式配置的 codec 不会被结构化后端绕过。未提供时按后端
   * 类型选默认值：结构化后端（IndexedDB/memory）默认 structuredCodec （原样存对象，利用原生 structured clone）；KV-only 后端默认
   * jsonCodec。
   */
  readonly codec?: ICodec<unknown, unknown>;
  readonly version?: number;
  readonly migrations?: Record<number, IMigration>;
  /** 默认 true：持久化数据会跨版本存活，读到脏数据比写入脏数据更常见。 */
  readonly validateOnRead?: boolean;
  readonly onDiagnostic?: (message: string) => void;
  readonly defaultOrderBy?: IRecordComparator<TDomain>;
};

export type IRecordComparator<TRecord> = (left: TRecord, right: TRecord) => number;

export type IListOptions<TRecord = unknown> = {
  /** V2 record key 先隔离 entity；legacy 兼容记录在显式 migrate 前仍需全库扫描。 */
  readonly range?: IKeyRange;
  readonly limit?: number;
  readonly orderBy?: IRecordComparator<TRecord>;
  readonly onInvalid?: IInvalidRecordAction | IInvalidRecordHandler<TRecord>;
};

export type IInvalidRecordAction = IStorageInvalidRecordAction;
export type IInvalidRecordIssue<TRecord = unknown> = {
  readonly key: IStorageKey;
  readonly raw: unknown;
  readonly record?: TRecord;
  readonly stage: IStorageRecordStage;
  readonly cause: unknown;
};
export type IInvalidRecordHandler<TRecord = unknown> = (
  issue: IInvalidRecordIssue<TRecord>
) => IInvalidRecordAction;

export type IMigrateOptions<TRecord = unknown> = {
  readonly batchSize?: number;
  readonly onInvalid?: IInvalidRecordAction | IInvalidRecordHandler<TRecord>;
};

export type IMigrateResult = {
  readonly scanned: number;
  readonly eligible: number;
  readonly migrated: number;
  readonly skipped: number;
  readonly alreadyCurrent: number;
  readonly conflicted: number;
};

export type IEntityTransactionScope<TDomain> = {
  get(id: IStorageKey): Promise<TDomain | undefined>;
  put(value: TDomain): Promise<IStorageKey>;
  remove(id: IStorageKey): Promise<void>;
};

export type IRepository<TDomain> = {
  get(id: IStorageKey, ctx?: IOperationContext): Promise<TDomain | undefined>;
  put(value: TDomain, ctx?: IOperationContext): Promise<IStorageKey>;
  remove(id: IStorageKey, ctx?: IOperationContext): Promise<void>;
  /** V2 结构化记录按 entity 物理前缀扫描并用共享 comparator 过滤；legacy 兼容记录会暂时走全库扫描。 */
  list(options?: IListOptions<TDomain>, ctx?: IOperationContext): Promise<TDomain[]>;
  stream(options?: IListOptions<TDomain>, ctx?: IOperationContext): AsyncIterableIterator<TDomain>;
  migrate(options?: IMigrateOptions<TDomain>, ctx?: IOperationContext): Promise<IMigrateResult>;
  /** 仅结构化后端支持（有真正的事务回滚）；KV-only 后端抛 UNSUPPORTED_CAPABILITY。 */
  batch<T>(
    run: (tx: IEntityTransactionScope<TDomain>) => Promise<T>,
    ctx?: IOperationContext
  ): Promise<T>;
};

export type IEntityDefinition<TDomain> = {
  readonly name: string;
  readonly version: number;
  connect(store: IKeyValueStore): IRepository<TDomain>;
};
