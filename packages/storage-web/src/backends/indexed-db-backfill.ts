import type { IKeyRange, IOperationContext, IStorageKey } from '../types/context.js'
import type {
  IRecordIndexDefinition,
  IRecordIndexHandle,
  IRecordIndexProjection,
  IRecordIndexReadiness
} from '@migaia/storage-contract'
import { StorageBackend } from '../constants.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'

/** Same-package registry keeps backend-private capability state out of public objects. */
const backfillStores = new WeakMap<object, IIndexedDbBackfillStore<unknown>>()

/** Tracks only transient lease/readiness races that may safely fall back to authoritative scans. */
const fallbackSafeFailures = new WeakSet<object>()

/** Create an internal contention failure without exposing a public marker or backend-private code. */
export const createBackfillContentionFailure = (): StorageError => {
  const failure = new StorageError(StorageErrorCode.unavailable, {
    backend: StorageBackend.indexedDb
  })
  fallbackSafeFailures.add(failure)
  return failure
}

/** Distinguish expected lease/readiness contention from projection and integrity failures. */
export const isBackfillContentionFailure = (value: unknown): boolean =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  fallbackSafeFailures.has(value)

export type IIndexedDbBackfillCandidate<TValue> = {
  readonly key: IStorageKey
  readonly raw: TValue
  readonly revision: number
}

/** Entity-owned preparation result used to enforce the decoded soft cap before issuing a batch. */
export type IIndexedDbBackfillPreparation = {
  readonly decodedBytes: number
  readonly projection?: IRecordIndexProjection
  readonly outcome: 'indexed' | 'skipped'
}

/** Optional entity projection hook; execution remains outside IndexedDB transactions. */
export type IIndexedDbBackfillReadOptions<TValue> = {
  readonly prepare?: (
    candidate: IIndexedDbBackfillCandidate<TValue>
  ) => Promise<IIndexedDbBackfillPreparation>
}

export type IIndexedDbBackfillProjection = {
  readonly key: IStorageKey
  readonly expectedRevision: number
  readonly projection?: IRecordIndexProjection
  readonly outcome: 'indexed' | 'skipped'
}

export type IIndexedDbBackfillBatch = {
  readonly generation: string
  readonly ownerToken: string
  readonly checkpoint: IStorageKey | undefined
  readonly nextCheckpoint: IStorageKey | undefined
  readonly endOfScan: boolean
  readonly projections: readonly IIndexedDbBackfillProjection[]
}

/** Durable receipt that permits one exact retry until a successor lease acquires the generation. */
export type IIndexedDbBackfillRetryReceipt = {
  readonly ownerToken: string
  readonly heartbeatRevision: number
  readonly batchIdentity: string
}

export type IIndexedDbBackfillSession<TValue> = {
  readonly generation: string
  readonly ownerToken: string
  renew(ctx?: IOperationContext): Promise<void>
  readBatch(
    ctx?: IOperationContext,
    options?: IIndexedDbBackfillReadOptions<TValue>
  ): Promise<{
    readonly checkpoint: IStorageKey | undefined
    readonly endOfScan: boolean
    readonly candidates: readonly IIndexedDbBackfillCandidate<TValue>[]
    readonly preparations?: readonly IIndexedDbBackfillPreparation[]
  }>
  commitBatch(
    batch: IIndexedDbBackfillBatch,
    ctx?: IOperationContext
  ): Promise<IRecordIndexReadiness>
  fail(cause: unknown, ctx?: IOperationContext): Promise<void>
  release(): void
}

export type IIndexedDbBackfillStore<TValue> = {
  ensureRecordIndexes(
    scope: string,
    definitions: readonly IRecordIndexDefinition[],
    ctx?: IOperationContext
  ): Promise<IRecordIndexHandle>
  getRecordIndexReadiness(
    handle: IRecordIndexHandle,
    ctx?: IOperationContext
  ): Promise<IRecordIndexReadiness>
  openBackfillSession(
    handle: IRecordIndexHandle,
    options: {
      readonly range: IKeyRange
      readonly allowComplete: boolean
      readonly batchSize?: number
      readonly leaseMs?: number
    },
    ctx?: IOperationContext
  ): Promise<IIndexedDbBackfillSession<TValue>>
}

/** Attach private capability state without adding reflectable properties to a backend. */
export const registerIndexedDbBackfillStore = <TValue>(
  backend: object,
  capability: IIndexedDbBackfillStore<TValue>
): void => {
  backfillStores.set(backend, capability as IIndexedDbBackfillStore<unknown>)
}

/** Snapshot-once guard used by entity orchestration; foreign stores fail closed. */
export const asIndexedDbBackfillStore = <TValue>(
  value: unknown
): IIndexedDbBackfillStore<TValue> | undefined => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  try {
    return backfillStores.get(value as object) as IIndexedDbBackfillStore<TValue> | undefined
  } catch {
    return undefined
  }
}
