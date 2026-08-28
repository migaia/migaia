export type IBackendKind = 'local' | 'session' | 'cookie' | 'indexeddb' | 'memory'

export type IStorageCapabilities = {
  readonly syncRead: boolean
  readonly binary: boolean
  readonly records: boolean
  readonly transactions: boolean
  readonly iteration: boolean
  /** Whether backend exposes logical secondary-index operations. Missing legacy fields mean false. */
  readonly secondaryIndexes: boolean
  /** Whether backend emits post-commit invalidation changes. Missing legacy fields mean false. */
  readonly changeFeed: boolean
  /** 单值近似上限，字节。cookie ~4096，localStorage ~5MB，IndexedDB 为 undefined（受配额而非单值限制）。 */
  readonly maxValueBytes: number | undefined
  /** 该后端上不可见的键是否可能存在（cookies 的 HttpOnly）。 */
  readonly opaqueEntries: boolean
}

export type IStorageCapabilitiesInspection = {
  readonly value: IStorageCapabilities | undefined
  readonly cause: unknown
}

/** Inspect capability accessors once while retaining a hostile getter failure for boundary owners. */
const inspectStorageCapabilities = (value: unknown): IStorageCapabilitiesInspection => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { value: undefined, cause: undefined }
  const candidate = value as Record<string, unknown>
  let syncRead: unknown
  let binary: unknown
  let records: unknown
  let transactions: unknown
  let iteration: unknown
  let maxValueBytes: unknown
  let opaqueEntries: unknown
  let secondaryIndexes: unknown
  let changeFeed: unknown
  try {
    syncRead = candidate.syncRead
    binary = candidate.binary
    records = candidate.records
    transactions = candidate.transactions
    iteration = candidate.iteration
    maxValueBytes = candidate.maxValueBytes
    opaqueEntries = candidate.opaqueEntries
    secondaryIndexes = candidate.secondaryIndexes
    changeFeed = candidate.changeFeed
  } catch (cause) {
    return { value: undefined, cause }
  }
  if (
    [syncRead, binary, records, transactions, iteration, opaqueEntries].some(
      (entry) => typeof entry !== 'boolean'
    ) ||
    (secondaryIndexes !== undefined && typeof secondaryIndexes !== 'boolean') ||
    (changeFeed !== undefined && typeof changeFeed !== 'boolean') ||
    (maxValueBytes !== undefined &&
      (typeof maxValueBytes !== 'number' ||
        !Number.isSafeInteger(maxValueBytes) ||
        maxValueBytes < 0))
  )
    return { value: undefined, cause: undefined }
  return {
    value: {
      syncRead: syncRead as boolean,
      binary: binary as boolean,
      records: records as boolean,
      transactions: transactions as boolean,
      iteration: iteration as boolean,
      maxValueBytes: maxValueBytes as number | undefined,
      opaqueEntries: opaqueEntries as boolean,
      secondaryIndexes: secondaryIndexes === undefined ? false : (secondaryIndexes as boolean),
      changeFeed: changeFeed === undefined ? false : (changeFeed as boolean)
    },
    cause: undefined
  }
}

/** Return capability facts and preserve the exact accessor failure for a composing guard. */
export const snapshotStorageCapabilitiesDetailed = inspectStorageCapabilities

/** Snapshot a capability descriptor once; invalid or throwing accessors return undefined. */
export const snapshotStorageCapabilities = (value: unknown): IStorageCapabilities | undefined => {
  return inspectStorageCapabilities(value).value
}

/** Validate the complete runtime capability descriptor shared by public boundaries. */
export const isStorageCapabilities = (value: unknown): value is IStorageCapabilities =>
  snapshotStorageCapabilities(value) !== undefined
