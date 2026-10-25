/**
 * Open provider label domain. Runtime admission applies the canonical lowercase backend-name
 * pattern; a label never grants capability or extension authority.
 */
export type IBackendKind = string

/** Provider capability facts, independent of any browser or database implementation. */
export type IStorageCapabilities = {
  /** Whether native KV batch writes and counted prefix removal are supported. Omission means false. */
  readonly batch?: boolean
  /** Whether a synchronous key-value channel is available. */
  readonly syncRead: boolean
  /** Whether the provider supports the byte channel. */
  readonly binary: boolean
  /** Whether the provider supports structured records. */
  readonly records: boolean
  /** Whether record operations can use a transaction scope. */
  readonly transactions: boolean
  /** Whether record iteration is available. */
  readonly iteration: boolean
  /** Whether backend exposes logical secondary-index operations. Missing legacy fields mean false. */
  readonly secondaryIndexes: boolean
  /** Whether backend emits post-commit invalidation changes. Missing legacy fields mean false. */
  readonly changeFeed: boolean
  /**
   * Provider-declared approximate per-value byte limit, or undefined when no single-value limit is
   * declared. Must be a non-negative safe integer when present; this package does not measure
   * quota.
   */
  readonly maxValueBytes: number | undefined
  /** Whether the backend can contain keys hidden from JavaScript, such as `HttpOnly` cookies. */
  readonly opaqueEntries: boolean
}

export type IStorageCapabilitiesInspection = {
  readonly value: IStorageCapabilities | undefined
  readonly cause: unknown
}

/** Checks declared scalar facts without copying them or executing provider operations. */
export const isStorageCapabilities = (value: unknown): value is IStorageCapabilities => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  /** A legacy descriptor may omit only the explicitly optional capability flags. */
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.syncRead === 'boolean' &&
    typeof candidate.binary === 'boolean' &&
    typeof candidate.records === 'boolean' &&
    typeof candidate.transactions === 'boolean' &&
    typeof candidate.iteration === 'boolean' &&
    typeof candidate.opaqueEntries === 'boolean' &&
    (candidate.secondaryIndexes === undefined || typeof candidate.secondaryIndexes === 'boolean') &&
    (candidate.changeFeed === undefined || typeof candidate.changeFeed === 'boolean') &&
    (candidate.batch === undefined || typeof candidate.batch === 'boolean') &&
    (candidate.maxValueBytes === undefined ||
      (typeof candidate.maxValueBytes === 'number' &&
        Number.isSafeInteger(candidate.maxValueBytes) &&
        candidate.maxValueBytes >= 0))
  )
}
