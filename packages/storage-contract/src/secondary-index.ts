import type { ITransactionScope } from './transaction.js'
import type { IStorageIterator } from './resource.js'
import type { IKeyRange, IOperationContext, IStorageKey, IWriteOptions } from './context.js'
import { inspectStoreShape, type IRecordStore } from './store.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'

/** Logical index description supplied to an index-capable provider; all fields are required. */
export type IRecordIndexDefinition = {
  /** Logical index name used by projections and queries within its scope. */
  readonly name: string
  /** Whether the index requires distinct projected keys; enforcement belongs to the provider. */
  readonly unique: boolean
  /** Whether one record can contribute multiple projected keys. */
  readonly multiEntry: boolean
  /** Definition revision used by the provider to distinguish index configurations. */
  readonly revision: number
}

/** Opaque provider-issued index identity. Keep every field when querying or writing indexed records. */
export type IRecordIndexHandle = {
  /** Logical namespace supplied when the index set was ensured. */
  readonly scope: string
  /** Provider-owned generation token; consumers must not synthesize or rewrite it. */
  readonly generation: string
  /** Provider-owned identity for the admitted definition set. */
  readonly fingerprint: string
}

/** Provider-reported progress; this contract does not run or schedule index construction. */
export type IRecordIndexReadiness = {
  /** Pending awaits work, running is in progress, complete is ready, and failed reports failure. */
  readonly status: 'pending' | 'running' | 'complete' | 'failed'
  /** Number of records the provider reports as scanned. */
  readonly scanned: number
  /** Number of records the provider reports as indexed; it need not equal scanned. */
  readonly indexed: number
}

/** One index projection: a single key or explicitly multiple keys for a multi-entry definition. */
export type IRecordIndexProjectionValue =
  /** One projected index key. */
  | { readonly kind: 'single'; readonly key: IStorageKey }
  /** Multiple projected index keys. */
  | { readonly kind: 'multiple'; readonly keys: readonly IStorageKey[] }

/** Logical index name to projected keys. An undefined entry supplies no projection for that index. */
export type IRecordIndexProjection = Readonly<
  Record<string, IRecordIndexProjectionValue | undefined>
>

/** Query against a provider-issued index handle, without exposing a host-native index object. */
export type IRecordIndexQuery = {
  /** Required handle obtained from ensureRecordIndexes. */
  readonly handle: IRecordIndexHandle
  /** Required logical index name within the handle's definition set. */
  readonly index: string
  /** Optional projected-key bounds. Omission requests an unbounded scan. */
  readonly range?: IKeyRange
  /**
   * Next requests forward order; prev requests reverse order. Omitted behavior belongs to the
   * provider.
   */
  readonly direction?: 'next' | 'prev'
  /** Optional result-count limit; validation and defaults belong to the provider. */
  readonly limit?: number
}

/** Indexed record operations valid during one backend-owned transaction callback. */
export type ISecondaryIndexTransactionScope<TValue = unknown> = ITransactionScope<TValue> &
  Required<Pick<ITransactionScope<TValue>, 'putIndexedRecord' | 'iterateRecordIndex'>>

/** Record-store extension whose logical indexes remain owned and executed by the provider. */
export type ISecondaryIndexRecordStore<TValue = unknown> = IRecordStore<TValue> & {
  /** Ensures a scoped definition set and returns its opaque handle; readiness is queried separately. */
  ensureRecordIndexes(
    scope: string,
    definitions: readonly IRecordIndexDefinition[],
    ctx?: IOperationContext
  ): Promise<IRecordIndexHandle>
  /** Reads provider-reported construction status and progress for this handle. */
  getRecordIndexReadiness(
    handle: IRecordIndexHandle,
    ctx?: IOperationContext
  ): Promise<IRecordIndexReadiness>
  /** Writes one record together with its explicit projections under the supplied index handle. */
  putIndexedRecord(
    value: TValue,
    key: IStorageKey,
    handle: IRecordIndexHandle,
    projection: IRecordIndexProjection,
    ctx?: IWriteOptions
  ): Promise<IStorageKey>
  /** Iterates primary-key/record pairs selected by a logical index query. */
  iterateRecordIndex(
    query: IRecordIndexQuery,
    ctx?: IOperationContext
  ): IStorageIterator<[IStorageKey, TValue]>
  /** Executes work under a provider-owned indexed transaction and returns the callback result. */
  transactionIndexed<TResult>(
    handle: IRecordIndexHandle,
    run: (tx: ISecondaryIndexTransactionScope<TValue>) => TResult,
    ctx?: IOperationContext
  ): Promise<Awaited<TResult>>
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

/**
 * Returns the same record store after base admission, a true secondaryIndexes flag, and checks that
 * all five extension methods are callable. It does not create indexes or invoke operations.
 * Incomplete shapes throw UNSUPPORTED_CAPABILITY; accessor/reflection failure remains on cause.
 */
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

/**
 * Same full secondary-index admission as the assertion, returning false for invalid or throwing
 * shapes.
 */
export const isSecondaryIndexRecordStore = (store: unknown): store is ISecondaryIndexRecordStore =>
  inspectSecondaryIndexShape(store).valid
