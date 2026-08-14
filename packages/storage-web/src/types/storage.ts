import { StorageError, StorageErrorCode } from './errors';
import {
  snapshotStorageCapabilities,
  type IBackendKind,
  type IStorageCapabilities
} from './capabilities';
import type {
  IKeyRange,
  IOperationContext,
  IStorageKey,
  ISyncWriteOptions,
  IWriteOptions
} from './context';
import type { ITransactionScope } from '../core/transaction';

/**
 * 结构等价于 DOM 的 `Storage` 接口，但不引用那个全局——只在 lib 里有 "DOM" 时才存在，而本包同时面向 Worker（lib: WebWorker，无
 * DOM）等场景。若这里 直接写 `Storage`，即使某个消费者只 import `indexedDb`（用不到这个类型）， TypeScript 仍会在解析
 * `@migaia/storage-web` 这个模块的声明图时把整个 barrel 一起类型检查，DOM-only 的 `Storage` 名字在 WebWorker lib 下解析
 * 失败，导致编译报错 "Cannot find name 'Storage'"——这条注释本身就是那次 真实踩坑的记录，复现见
 * fixtures/consumers/tsconfig.worker.json。
 */
export interface IWebStorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
}

/** 同步通道。仅同步后端提供；由该后端的实现直接驱动，异步方法是它的薄包装。 */
export interface ISyncKeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string, options?: ISyncWriteOptions): void;
  remove(key: string): void;
  has(key: string): boolean;
  keys(): string[];
  clearValues(): void;
}

/** L0：所有后端都实现的字符串键值通道。 */
export interface IKeyValueStore {
  readonly backend: IBackendKind;
  readonly capabilities: IStorageCapabilities;

  get(key: string, ctx?: IOperationContext): Promise<string | null>;
  set(key: string, value: string, ctx?: IWriteOptions): Promise<void>;
  remove(key: string, ctx?: IOperationContext): Promise<void>;
  has(key: string, ctx?: IOperationContext): Promise<boolean>;
  keys(ctx?: IOperationContext): Promise<string[]>;
  clearValues(ctx?: IOperationContext): Promise<void>;
  clearAll(ctx?: IOperationContext): Promise<void>;
  dispose(): Promise<void>;

  /** 仅同步后端提供；IndexedDB 等异步后端上为 undefined。 */
  readonly sync?: ISyncKeyValueStore;
}

/**
 * 把某个 `IKeyValueStore` 变体的 `sync` 字段从 optional 收紧成必然存在。
 * localStorage/sessionStorage/memoryStorage/cookies 这些同步后端的工厂函数 用它标注返回类型，调用方因此不需要在
 * `store.sync!.get(...)` 里写非空断言—— 类型层面就知道这些后端一定有 sync 通道。
 */
export type ISyncCapableStore<TStore extends { readonly sync?: object }> = TStore & {
  readonly sync: NonNullable<TStore['sync']>;
};

/** L1：结构化后端额外提供的字节与对象通道。 */
export interface IRecordStore<TValue = unknown> extends IKeyValueStore {
  getBytes(key: string, ctx?: IOperationContext): Promise<Uint8Array | null>;
  setBytes(key: string, value: Uint8Array, ctx?: IWriteOptions): Promise<void>;
  clearBytes(ctx?: IOperationContext): Promise<void>;
  getRecord(key: IStorageKey, ctx?: IOperationContext): Promise<TValue | undefined>;
  putRecord(value: TValue, key?: IStorageKey, ctx?: IWriteOptions): Promise<IStorageKey>;
  deleteRecord(key: IStorageKey, ctx?: IOperationContext): Promise<void>;
  clearRecords(ctx?: IOperationContext): Promise<void>;
  clearAll(ctx?: IOperationContext): Promise<void>;
  /** Optional backend-owned metadata channel used by resumable maintenance migrations. */
  readonly metadata?: {
    get(key: string, ctx?: IOperationContext): Promise<unknown | undefined>;
    set(key: string, value: unknown, ctx?: IWriteOptions): Promise<void>;
    delete(key: string, ctx?: IOperationContext): Promise<void>;
  };
  iterateRecords(
    range?: IKeyRange,
    ctx?: IOperationContext
  ): AsyncIterableIterator<[IStorageKey, TValue]>;
  transaction<T>(
    run: (tx: ITransactionScope<TValue>) => Promise<T>,
    ctx?: IOperationContext
  ): Promise<T>;
}

const BACKEND_KINDS = new Set<IBackendKind>(['memory', 'local', 'session', 'cookie', 'indexeddb']);

type IStoreShapeInspection = {
  readonly valid: boolean;
  readonly backend: IBackendKind | undefined;
};

/** Inspect each public store field once and never leak accessor failures from a predicate. */
const inspectStoreShape = (store: unknown, records: boolean): IStoreShapeInspection => {
  if (typeof store !== 'object' || store === null || Array.isArray(store))
    return { valid: false, backend: undefined };
  const candidate = store as Record<string, unknown>;
  let backend: unknown;
  let capabilitiesValue: unknown;
  let methods: unknown[];
  try {
    backend = candidate.backend;
    capabilitiesValue = candidate.capabilities;
    methods = ['get', 'set', 'remove', 'has', 'keys', 'clearValues', 'clearAll', 'dispose'].map(
      (name) => candidate[name]
    );
    if (records)
      methods.push(
        ...[
          'getBytes',
          'setBytes',
          'clearBytes',
          'getRecord',
          'putRecord',
          'deleteRecord',
          'clearRecords',
          'iterateRecords',
          'transaction'
        ].map((name) => candidate[name])
      );
  } catch {
    return { valid: false, backend: undefined };
  }
  const normalizedBackend = BACKEND_KINDS.has(backend as IBackendKind)
    ? (backend as IBackendKind)
    : undefined;
  const capabilities = snapshotStorageCapabilities(capabilitiesValue);
  const validCapabilities =
    capabilities !== undefined &&
    (!records ||
      (capabilities.records &&
        capabilities.binary &&
        capabilities.transactions &&
        capabilities.iteration));
  return {
    valid:
      normalizedBackend !== undefined &&
      validCapabilities &&
      methods.every((method) => typeof method === 'function'),
    backend: normalizedBackend
  };
};

/** Check the complete callable L0 surface and capability descriptor at runtime boundaries. */
export const isKeyValueStore = (store: unknown): store is IKeyValueStore =>
  inspectStoreShape(store, false).valid;

/** 运行时收窄到 IRecordStore；能力或最小方法形状不足时立即抛错。 */
export const asRecordStore = <T = unknown>(store: IKeyValueStore): IRecordStore<T> => {
  const inspection = inspectStoreShape(store, true);
  if (!inspection.valid)
    throw new StorageError(StorageErrorCode.unsupported, {
      backend: inspection.backend
    });
  return store as IRecordStore<T>;
};

export const isRecordStore = (store: IKeyValueStore): store is IRecordStore =>
  inspectStoreShape(store, true).valid;
