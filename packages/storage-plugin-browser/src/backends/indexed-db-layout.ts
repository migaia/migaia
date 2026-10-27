// Store names, limits, layout fingerprints, byte helpers and key ranges for the IndexedDB backend (see ./indexed-db.ts).
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { encodeFlatStorageKey, assertKeyRange, createStorageToken } from '@migaia/storage-host/sdk'
import { isStorageErrorFamily, type IStorageErrorFamily } from './errors.js'
import { StorageError } from '../types/errors.js'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { StorageBackend, StorageOperation } from '../constants.js'
import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import { UtilsAbortError } from '@migaia/utils/promise'
import { UTILS_SOURCE, UtilsErrorCode } from '@migaia/utils/error'
import { utf8ByteLength } from '@migaia/utils/bytes'
import type { IKeyRange, IStorageKey } from '../types/context.js'
import type { IRecordIndexProjection } from '@migaia/storage-contract'

export const REVISIONS_STORE_NAME = '__storage_web_revisions__'
export const META_STORE_NAME = 'storage-plugin-browser:meta'
/** Private metadata namespace; public string metadata keys must never authorize backend state. */
export const INTERNAL_META_NAMESPACE = '__storage_web_internal__'
export const META_SCHEMA_KEY: IDBValidKey = [INTERNAL_META_NAMESPACE, 'schema']
/** Historical mirror retained for non-authoritative inspection of existing databases. */
export const LEGACY_META_SCHEMA_KEY = 'schema'
export const CURRENT_SCHEMA_VERSION = 3
export const LEGACY_RECORDS_STORE_NAME = 'documents'
export const INDEX_RECORDS_STORE_NAME = 'storage-plugin-browser:index-records'
/** Build the immutable physical-layout identity shared by same-page and wire coordination. */
export const indexedDbLayoutFingerprint = (
  kvStoreName: string,
  bytesStoreName: string,
  recordsStoreName: string
): string =>
  JSON.stringify({
    schema: CURRENT_SCHEMA_VERSION,
    stores: [
      kvStoreName,
      bytesStoreName,
      recordsStoreName,
      REVISIONS_STORE_NAME,
      META_STORE_NAME,
      INDEX_RECORDS_STORE_NAME
    ],

    sidecar: {
      keyPath: ['scope', 'indexName', 'generation', 'indexValue', 'recordKey'],
      indexes: {
        lookup: ['scope', 'indexName', 'generation', 'indexValue'],
        record: ['scope', 'generation', 'recordKey']
      }
    }
  })
export const LEGACY_RECORDS_MIGRATION_KEY: IDBValidKey = [
  INTERNAL_META_NAMESPACE,
  'migration:records-v1-to-v2'
]
/** Historical epoch key is not authority and remains stable for existing revision diagnostics. */
export const RECORD_EPOCH_KEY = '__storage_web_record_epoch__'
/** Historical migration mirror is never read to authorize a current migration. */
export const LEGACY_RECORDS_MIGRATION_MIRROR_KEY = 'migration:records-v1-to-v2'
export const LEGACY_MIGRATION_BATCH_SIZE = 128
/** Bounds `iterateRecordIndex` candidates per short readonly page transaction. */
export const INDEX_QUERY_PAGE_SIZE = 64
/** Soft decoded-value cap for one backfill page. */
export const INDEX_BACKFILL_SOFT_CAP_BYTES = 1024 * 1024
/** Hard row cap for one backfill commit, before any sidecar write. */
const INDEX_BACKFILL_PROJECTION_ROW_CAP = 4096
/** Hard canonical encoded-key byte cap for one backfill commit. */
const INDEX_BACKFILL_PROJECTION_BYTE_CAP = 2 * 1024 * 1024
/** Hard row cap for one prepared record, matching the entity projection contract. */
const INDEX_BACKFILL_RECORD_ROW_CAP = 1024
/** Fixed private backfill batch lower bound. */
export const INDEX_BACKFILL_MIN_BATCH_SIZE = 1
/** Fixed private backfill batch upper bound. */
export const INDEX_BACKFILL_MAX_BATCH_SIZE = 512
/** Fixed private lease lower bound in milliseconds. */
export const INDEX_BACKFILL_MIN_LEASE_MS = 5_000
/** Fixed private lease upper bound in milliseconds. */
export const INDEX_BACKFILL_MAX_LEASE_MS = 120_000
/** Default lease duration in milliseconds. */
export const INDEX_BACKFILL_DEFAULT_LEASE_MS = 30_000

/** Persisted owner authority; duration is captured at acquisition and never wall-clock derived. */
export type IBackfillLease = {
  readonly ownerToken: string
  readonly heartbeatRevision: number
  readonly leaseMs: number
}

/** Provides a clamped monotonic sample; missing performance APIs fail closed by never advancing. */
export const createMonotonicClock = (): (() => number) => {
  let last = 0
  return () => {
    const sample =
      typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : last
    if (Number.isFinite(sample) && sample > last) last = sample
    return last
  }
}
export const INTERNAL_STORE_NAMES = new Set([
  REVISIONS_STORE_NAME,
  META_STORE_NAME,
  INDEX_RECORDS_STORE_NAME
])

/** 判断 IndexedDB 数据库/对象仓库名称是否满足构造期契约。 */
export const isValidStoreName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

/** Bounds private generation tokens so the native prefix-successor proof cannot depend on user data. */
const INDEX_GENERATION_MAX_LENGTH = 128

/** Accept only the bounded NUL-free grammar used by backend-owned index generations. */
export const isValidIndexGeneration = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= INDEX_GENERATION_MAX_LENGTH &&
  /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value)

/** Create one independent backend-owned generation token for a new or rotated index. */
export const createIndexGeneration = (): string => {
  const generation = createStorageToken()
  if (!isValidIndexGeneration(generation))
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb
    })
  return generation
}

export const toIdbKey = (key: IStorageKey): IDBValidKey => key as IDBValidKey

type IBackfillProjectionMetrics = {
  readonly rows: number
  readonly bytes: number
}

/** Count projected rows and canonical key bytes before a backfill can issue or commit work. */
export const estimateBackfillProjectionMetrics = (
  projection: IRecordIndexProjection | undefined,
  recordKey: IStorageKey,
  scope: string,
  generation: string
): IBackfillProjectionMetrics => {
  if (projection === undefined) return { rows: 0, bytes: 0 }
  let rows = 0
  let bytes = 0
  for (const [indexName, entry] of Object.entries(projection)) {
    if (entry === undefined) continue
    const values = entry.kind === 'multiple' ? entry.keys : [entry.key]
    for (const indexValue of values) {
      rows += 1
      const persistedPrimaryKey: IStorageKey = [scope, indexName, generation, indexValue, recordKey]
      bytes += utf8ByteLength(encodeFlatStorageKey(persistedPrimaryKey))
    }
  }
  return { rows, bytes }
}

/** Reject bounded backfill work without exposing record keys or values in the error detail. */
export const assertBackfillProjectionLimits = (
  metrics: IBackfillProjectionMetrics,
  scope: 'record' | 'batch'
): void => {
  const rowLimit =
    scope === 'record' ? INDEX_BACKFILL_RECORD_ROW_CAP : INDEX_BACKFILL_PROJECTION_ROW_CAP
  if (metrics.rows > rowLimit || metrics.bytes > INDEX_BACKFILL_PROJECTION_BYTE_CAP)
    throw new StorageError(StorageBrowserErrorCode.valueTooLarge, {
      backend: StorageBackend.indexedDb,
      cause: new RangeError(StorageErrorText.indexBackfillProjectionTooLarge)
    })
}

/** Preserve contract cancellation identity when `withTimeout` reports through its utils error. */
export const normalizeIndexedDbOperationError = (
  error: unknown,
  expiredScope?: true
): IStorageErrorFamily => {
  if (error instanceof UtilsAbortError)
    return new StorageContractError(StorageContractErrorCode.aborted, {
      backend: StorageBackend.indexedDb,
      cause: error.cause
    })
  if (
    error !== null &&
    typeof error === 'object' &&
    'source' in error &&
    error.source === UTILS_SOURCE &&
    'code' in error &&
    error.code === UtilsErrorCode.deadlineExceeded
  )
    return new StorageContractError(StorageContractErrorCode.aborted, {
      backend: StorageBackend.indexedDb,
      cause: error
    })
  if (isStorageErrorFamily(error)) return error
  return new StorageError(StorageBrowserErrorCode.transactionFailed, {
    backend: StorageBackend.indexedDb,
    operation: expiredScope ? StorageOperation.transactionScope : undefined,
    cause: error
  })
}

/** Create the canonical bounded decoded-payload failure without exposing record data. */
export const backfillDecodedTooLarge = (): StorageError =>
  new StorageError(StorageBrowserErrorCode.valueTooLarge, {
    backend: StorageBackend.indexedDb,
    cause: new RangeError(StorageErrorText.indexBackfillDecodedTooLarge)
  })

/** Detach mutable record/byte payloads before the first asynchronous backend boundary. */
export const snapshotWriteValue = <T>(value: T, key: IStorageKey): T => {
  try {
    return structuredClone(value)
  } catch (cause) {
    throw new StorageError(StorageBrowserErrorCode.serializeFailed, {
      backend: StorageBackend.indexedDb,
      key,
      cause
    })
  }
}

/**
 * IndexedDB 的结构化克隆可能在与调用方不同的 realm 里重建 ArrayBuffer（测试环境下 fake-indexeddb 与 jsdom 就是典型场景）。通用 guard 通过
 * intrinsic 内部槽判定真实品牌， 避免 `instanceof` 的跨 realm 假阴性和 `constructor.name` / tag 伪造的假阳性。
 */
const isRawArrayBuffer = (value: unknown): value is ArrayBuffer => isArrayBuffer(value)

/** Root and transaction reads interpret the same native-cloned binary payload shapes. */
export const readIndexedDbBytes = (value: unknown): Uint8Array | null => {
  if (isUint8Array(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (isRawArrayBuffer(value)) return new Uint8Array(value)
  return null
}

export const toIdbRange = (
  range: IKeyRange | undefined,
  KeyRange: typeof IDBKeyRange | undefined
): IDBKeyRange | undefined => {
  assertKeyRange(range, StorageBackend.indexedDb)
  /** IDBKeyRange consumes these bounds synchronously before any native request awaits. */
  const rangeSnapshot = range
  if (!rangeSnapshot) return undefined
  if (!KeyRange)
    throw new StorageError(StorageBrowserErrorCode.unavailable, {
      backend: StorageBackend.indexedDb,
      cause: new Error(StorageErrorText.indexedDbKeyRangeUnavailable)
    })
  if (rangeSnapshot.lower !== undefined && rangeSnapshot.upper !== undefined)
    return KeyRange.bound(
      toIdbKey(rangeSnapshot.lower),
      toIdbKey(rangeSnapshot.upper),
      rangeSnapshot.lowerOpen ?? false,
      rangeSnapshot.upperOpen ?? false
    )
  if (rangeSnapshot.lower !== undefined)
    return KeyRange.lowerBound(toIdbKey(rangeSnapshot.lower), rangeSnapshot.lowerOpen ?? false)
  if (rangeSnapshot.upper !== undefined)
    return KeyRange.upperBound(toIdbKey(rangeSnapshot.upper), rangeSnapshot.upperOpen ?? false)
  return undefined
}
