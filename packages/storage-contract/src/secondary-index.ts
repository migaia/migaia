import type { IKeyRange, IOperationContext, IStorageKey, IWriteOptions } from './context.js'
import { inspectStoreShape, type IRecordStore } from './store.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'

export type IRecordIndexDefinition = {
  readonly name: string
  readonly unique: boolean
  readonly multiEntry: boolean
  readonly revision: number
}

export type IRecordIndexHandle = {
  readonly scope: string
  readonly generation: string
  readonly fingerprint: string
}

export type IRecordIndexReadiness = {
  readonly status: 'pending' | 'running' | 'complete' | 'failed'
  readonly scanned: number
  readonly indexed: number
}

export type IRecordIndexProjectionValue =
  | { readonly kind: 'single'; readonly key: IStorageKey }
  | { readonly kind: 'multiple'; readonly keys: readonly IStorageKey[] }

export type IRecordIndexProjection = Readonly<
  Record<string, IRecordIndexProjectionValue | undefined>
>

export type IRecordIndexQuery = {
  readonly handle: IRecordIndexHandle
  readonly index: string
  readonly range?: IKeyRange
  readonly direction?: 'next' | 'prev'
  readonly limit?: number
}

export type ISecondaryIndexTransactionScope<TValue = unknown> = {
  get(key: IStorageKey): Promise<TValue | undefined>
  put(value: TValue, key: IStorageKey, projection: IRecordIndexProjection): Promise<IStorageKey>
  delete(key: IStorageKey): Promise<void>
}

export type ISecondaryIndexRecordStore<TValue = unknown> = IRecordStore<TValue> & {
  ensureRecordIndexes(
    scope: string,
    definitions: readonly IRecordIndexDefinition[],
    ctx?: IOperationContext
  ): Promise<IRecordIndexHandle>
  getRecordIndexReadiness(
    handle: IRecordIndexHandle,
    ctx?: IOperationContext
  ): Promise<IRecordIndexReadiness>
  putIndexedRecord(
    value: TValue,
    key: IStorageKey,
    handle: IRecordIndexHandle,
    projection: IRecordIndexProjection,
    ctx?: IWriteOptions
  ): Promise<IStorageKey>
  iterateRecordIndex(
    query: IRecordIndexQuery,
    ctx?: IOperationContext
  ): AsyncIterableIterator<[IStorageKey, TValue]>
  transactionIndexed<T>(
    handle: IRecordIndexHandle,
    run: (tx: ISecondaryIndexTransactionScope<TValue>) => Promise<T>,
    ctx?: IOperationContext
  ): Promise<T>
}

const SECONDARY_INDEX_METHODS = [
  'ensureRecordIndexes',
  'getRecordIndexReadiness',
  'putIndexedRecord',
  'iterateRecordIndex',
  'transactionIndexed'
] as const

/** Compose canonical record admission without discarding its original reflection/getter failure. */
const inspectSecondaryIndexShape = (value: unknown) => {
  /** This module adds only extension checks; base record requirements stay owned by store.ts. */
  const snapshot = inspectStoreShape(value, true)
  if (!snapshot.valid || snapshot.capabilities === undefined) return snapshot
  try {
    if (
      snapshot.capabilities.secondaryIndexes === true &&
      SECONDARY_INDEX_METHODS.every(
        (name) => typeof (value as Record<string, unknown>)[name] === 'function'
      )
    )
      return snapshot
    return { ...snapshot, valid: false }
  } catch (cause) {
    return { ...snapshot, valid: false, cause }
  }
}

/** Narrow a record store only when every secondary-index operation is callable. */
export const asSecondaryIndexRecordStore = <T = unknown>(
  store: IRecordStore<T>
): ISecondaryIndexRecordStore<T> => {
  const snapshot = inspectSecondaryIndexShape(store)
  if (!snapshot.valid)
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: undefined,
      cause: snapshot.cause
    })
  return store as ISecondaryIndexRecordStore<T>
}

/** Check secondary-index capability without invoking backend operations. */
export const isSecondaryIndexRecordStore = (store: unknown): store is ISecondaryIndexRecordStore =>
  inspectSecondaryIndexShape(store).valid
