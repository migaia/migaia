import { StorageContractError, StorageContractErrorCode } from './errors.js'
import {
  snapshotStorageCapabilitiesDetailed,
  type IBackendKind,
  type IStorageCapabilities
} from './capabilities.js'
import type {
  IKeyRange,
  IOperationContext,
  IStorageKey,
  ISyncWriteOptions,
  IWriteOptions
} from './context.js'
import type { ITransactionScope } from './transaction.js'

/** 同步通道。仅同步后端提供；由该后端的实现直接驱动，异步方法是它的薄包装。 */
export type ISyncKeyValueStore = {
  get(key: string): string | null
  set(key: string, value: string, options?: ISyncWriteOptions): void
  remove(key: string): void
  has(key: string): boolean
  keys(): string[]
  clearValues(): void
}

/** L0：所有后端都实现的字符串键值通道。 */
export type IKeyValueStore = {
  readonly backend: IBackendKind
  readonly capabilities: IStorageCapabilities

  get(key: string, ctx?: IOperationContext): Promise<string | null>
  set(key: string, value: string, ctx?: IWriteOptions): Promise<void>
  remove(key: string, ctx?: IOperationContext): Promise<void>
  has(key: string, ctx?: IOperationContext): Promise<boolean>
  keys(ctx?: IOperationContext): Promise<string[]>
  clearValues(ctx?: IOperationContext): Promise<void>
  clearAll(ctx?: IOperationContext): Promise<void>
  dispose(): Promise<void>

  /** 仅同步后端提供；IndexedDB 等异步后端上为 undefined。 */
  readonly sync?: ISyncKeyValueStore
}

/**
 * 把某个 `IKeyValueStore` 变体的 `sync` 字段从 optional 收紧成必然存在。
 * localStorage/sessionStorage/memoryStorage/cookies 这些同步后端的工厂函数用它标注返回类型。
 */
export type ISyncCapableStore<TStore extends { readonly sync?: object }> = TStore & {
  readonly sync: NonNullable<TStore['sync']>
}

/** L1：结构化后端额外提供的字节与对象通道。 */
export type IRecordStore<TValue = unknown> = IKeyValueStore & {
  getBytes(key: string, ctx?: IOperationContext): Promise<Uint8Array | null>
  setBytes(key: string, value: Uint8Array, ctx?: IWriteOptions): Promise<void>
  clearBytes(ctx?: IOperationContext): Promise<void>
  getRecord(key: IStorageKey, ctx?: IOperationContext): Promise<TValue | undefined>
  putRecord(value: TValue, key?: IStorageKey, ctx?: IWriteOptions): Promise<IStorageKey>
  deleteRecord(key: IStorageKey, ctx?: IOperationContext): Promise<void>
  clearRecords(ctx?: IOperationContext): Promise<void>
  clearAll(ctx?: IOperationContext): Promise<void>
  /** Optional backend-owned metadata channel used by resumable maintenance migrations. */
  readonly metadata?: {
    get(key: string, ctx?: IOperationContext): Promise<unknown | undefined>
    set(key: string, value: unknown, ctx?: IWriteOptions): Promise<void>
    delete(key: string, ctx?: IOperationContext): Promise<void>
  }
  iterateRecords(
    range?: IKeyRange,
    ctx?: IOperationContext
  ): AsyncIterableIterator<[IStorageKey, TValue]>
  transaction<T>(
    run: (tx: ITransactionScope<TValue>) => Promise<T>,
    ctx?: IOperationContext
  ): Promise<T>
}

const BACKEND_KINDS = new Set<IBackendKind>(['memory', 'local', 'session', 'cookie', 'indexeddb'])

type IStoreShapeInspection = {
  readonly valid: boolean
  readonly backend: IBackendKind | undefined
  readonly capabilities: IStorageCapabilities | undefined
  readonly dispose: (() => Promise<void>) | undefined
  readonly cause: unknown
}

/** Detailed one-read admission result retained for lifecycle owners at package boundaries. */
export type IKeyValueStoreAdmission =
  | {
      readonly valid: true
      readonly store: IKeyValueStore
      readonly backend: IBackendKind
      readonly capabilities: IStorageCapabilities
      readonly dispose: () => Promise<void>
      readonly receiver: object
    }
  | {
      readonly valid: false
      readonly cause: unknown
    }

/** Inspect each public store field once and never leak accessor failures from a predicate. */
const inspectStoreShape = (store: unknown, records: boolean): IStoreShapeInspection => {
  if (typeof store !== 'object' || store === null || Array.isArray(store))
    return {
      valid: false,
      backend: undefined,
      capabilities: undefined,
      dispose: undefined,
      cause: undefined
    }
  const candidate = store as Record<string, unknown>
  let backend: unknown
  let capabilitiesValue: unknown
  let methods: unknown[]
  let dispose: unknown
  try {
    backend = candidate.backend
    capabilitiesValue = candidate.capabilities
    methods = ['get', 'set', 'remove', 'has', 'keys', 'clearValues', 'clearAll'].map(
      (name) => candidate[name]
    )
    dispose = candidate.dispose
    methods.push(dispose)
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
      )
  } catch (cause) {
    return {
      valid: false,
      backend: undefined,
      capabilities: undefined,
      dispose: undefined,
      cause
    }
  }
  const normalizedBackend = BACKEND_KINDS.has(backend as IBackendKind)
    ? (backend as IBackendKind)
    : undefined
  const capabilitiesInspection = snapshotStorageCapabilitiesDetailed(capabilitiesValue)
  const capabilities = capabilitiesInspection.value
  const validCapabilities =
    capabilities !== undefined &&
    (!records ||
      (capabilities.records &&
        capabilities.binary &&
        capabilities.transactions &&
        capabilities.iteration))
  return {
    valid:
      normalizedBackend !== undefined &&
      validCapabilities &&
      methods.every((method) => typeof method === 'function'),
    backend: normalizedBackend,
    capabilities,
    dispose: typeof dispose === 'function' ? (dispose as () => Promise<void>) : undefined,
    cause: capabilitiesInspection.cause
  }
}

/** Admit one key-value store while preserving the exact hostile accessor failure, if any. */
export const snapshotKeyValueStoreDetailed = (store: unknown): IKeyValueStoreAdmission => {
  const inspection = inspectStoreShape(store, false)
  if (
    !inspection.valid ||
    inspection.backend === undefined ||
    inspection.capabilities === undefined ||
    inspection.dispose === undefined
  )
    return { valid: false, cause: inspection.cause }
  return {
    valid: true,
    store: store as IKeyValueStore,
    backend: inspection.backend,
    capabilities: inspection.capabilities,
    dispose: inspection.dispose,
    receiver: store as object
  }
}

/** Return one immutable base-store inspection so capability guards do not reread hostile accessors. */
export const snapshotKeyValueStore = (
  store: unknown
):
  | {
      readonly store: IKeyValueStore
      readonly backend: IBackendKind
      readonly capabilities: IStorageCapabilities
    }
  | undefined => {
  const inspection = snapshotKeyValueStoreDetailed(store)
  if (!inspection.valid) return undefined
  return {
    store: inspection.store,
    backend: inspection.backend,
    capabilities: inspection.capabilities
  }
}

/** Return one immutable record-store inspection for capability composition. */
export const snapshotRecordStore = <T = unknown>(
  store: unknown
):
  | {
      readonly store: IRecordStore<T>
      readonly backend: IBackendKind
      readonly capabilities: IStorageCapabilities
    }
  | undefined => {
  const inspection = inspectStoreShape(store, true)
  if (!inspection.valid || inspection.capabilities === undefined) return undefined
  return {
    store: store as IRecordStore<T>,
    backend: inspection.backend!,
    capabilities: inspection.capabilities
  }
}

/** Check the complete callable L0 surface and capability descriptor at runtime boundaries. */
export const isKeyValueStore = (store: unknown): store is IKeyValueStore =>
  inspectStoreShape(store, false).valid

/** 运行时收窄到 IRecordStore；能力或最小方法形状不足时立即抛契约级 unsupported。 */
export const asRecordStore = <T = unknown>(store: IKeyValueStore): IRecordStore<T> => {
  const inspection = inspectStoreShape(store, true)
  if (!inspection.valid)
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: inspection.backend
    })
  return store as IRecordStore<T>
}

export const isRecordStore = (store: IKeyValueStore): store is IRecordStore =>
  inspectStoreShape(store, true).valid
