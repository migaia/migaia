import type { IKeyRange, IOperationContext, IStorageKey } from '@migaia/storage-contract'
import type {
  IRecordIndexDefinition,
  IRecordIndexHandle,
  IRecordIndexProjection,
  IRecordIndexReadiness
} from '@migaia/storage-contract'
import { StorageError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { resolveBackendCapabilityOwner } from '../core/backend-registry.js'

/** The original neutral registry keeps backend-private provider state out of public objects. */
const backfillStores = new WeakMap<object, IRecordIndexBackfillStore<unknown>>()

/** Tracks only transient lease/readiness races that may safely fall back to authoritative scans. */
const fallbackSafeFailures = new WeakSet<object>()

/** Stable persisted scan phases; canonical records are authoritative over legacy shadows. */
export const RecordIndexBackfillPhase = {
  canonical: 'canonical',
  legacy: 'legacy'
} as const

export type IRecordIndexBackfillPhase =
  (typeof RecordIndexBackfillPhase)[keyof typeof RecordIndexBackfillPhase]

/** Mark the original already-coded native contention failure without changing its identity. */
export const markRecordIndexBackfillContentionFailure = (error: object): void => {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null)
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
      cause: new TypeError(StorageErrorText.backfillFailureObject)
    })
  fallbackSafeFailures.add(error)
}

/** Distinguish expected lease/readiness contention from projection and integrity failures. */
export const isBackfillContentionFailure = (value: unknown): boolean =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  fallbackSafeFailures.has(value)

export type IRecordIndexBackfillCandidate<TValue> = {
  readonly key: IStorageKey
  readonly raw: TValue
  readonly revision: number
  readonly phase?: IRecordIndexBackfillPhase
}

/** Entity-owned preparation result used to enforce the decoded soft cap before issuing a batch. */
export type IRecordIndexBackfillPreparation = {
  readonly decodedBytes: number
  readonly projection?: IRecordIndexProjection
  readonly outcome: 'indexed' | 'skipped'
  /** False only for physically scanned records outside the entity scope. */
  readonly counted?: boolean
  /** Entity-owned legacy records, including shadows, prevent migration-free completion. */
  readonly legacy?: true
}

/** Optional entity projection hook; execution remains outside IndexedDB transactions. */
export type IRecordIndexBackfillReadOptions<TValue> = {
  readonly prepare?: (
    candidate: IRecordIndexBackfillCandidate<TValue>
  ) => Promise<IRecordIndexBackfillPreparation>
}

export type IRecordIndexBackfillProjection = {
  readonly key: IStorageKey
  readonly expectedRevision: number
  readonly projection?: IRecordIndexProjection
  readonly outcome: 'indexed' | 'skipped'
  /** False only for physically scanned records outside the entity scope. */
  readonly counted?: boolean
}

export type IRecordIndexBackfillBatch = {
  readonly phase?: IRecordIndexBackfillPhase
  readonly generation: string
  readonly ownerToken: string
  readonly checkpoint: IStorageKey | undefined
  readonly nextCheckpoint: IStorageKey | undefined
  readonly endOfScan: boolean
  readonly projections: readonly IRecordIndexBackfillProjection[]
}

/** Durable receipt that permits one exact retry until a successor lease acquires the generation. */
export type IRecordIndexBackfillRetryReceipt = {
  readonly ownerToken: string
  readonly heartbeatRevision: number
  readonly batchIdentity: string
}

export type IRecordIndexBackfillSession<TValue> = {
  readonly generation: string
  readonly ownerToken: string
  renew(ctx?: IOperationContext): Promise<void>
  readBatch(
    ctx?: IOperationContext,
    options?: IRecordIndexBackfillReadOptions<TValue>
  ): Promise<{
    readonly phase?: IRecordIndexBackfillPhase
    readonly checkpoint: IStorageKey | undefined
    readonly endOfScan: boolean
    readonly candidates: readonly IRecordIndexBackfillCandidate<TValue>[]
    readonly preparations?: readonly IRecordIndexBackfillPreparation[]
  }>
  commitBatch(
    batch: IRecordIndexBackfillBatch,
    ctx?: IOperationContext
  ): Promise<IRecordIndexReadiness>
  fail(cause: unknown, ctx?: IOperationContext): Promise<void>
  release(): void
}

export type IRecordIndexBackfillStore<TValue> = {
  /** Prepare the fixed physical layout without publishing any public capability. */
  readonly prepare?: () => Promise<void>
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
      readonly legacyRange?: IKeyRange
      readonly includeLegacy?: boolean
      readonly allowComplete: boolean
      readonly batchSize?: number
      readonly leaseMs?: number
    },
    ctx?: IOperationContext
  ): Promise<IRecordIndexBackfillSession<TValue>>
}

/** Attach private capability state without adding reflectable properties to a backend. */
export const registerRecordIndexBackfillStore = <TValue>(
  backend: object,
  capability: IRecordIndexBackfillStore<TValue>
): void => {
  if ((typeof backend !== 'object' && typeof backend !== 'function') || backend === null)
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
      cause: new TypeError(StorageErrorText.backfillBackendObject)
    })
  backfillStores.set(
    resolveBackendCapabilityOwner(backend),
    capability as IRecordIndexBackfillStore<unknown>
  )
}

/** Pure private-table lookup used by entity orchestration; foreign stores remain unsupported. */
export const asRecordIndexBackfillStore = <TValue>(
  value: unknown
): IRecordIndexBackfillStore<TValue> | undefined => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  return backfillStores.get(resolveBackendCapabilityOwner(value)) as
    | IRecordIndexBackfillStore<TValue>
    | undefined
}
