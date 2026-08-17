export type IBackendKind = 'local' | 'session' | 'cookie' | 'indexeddb' | 'memory';

export type IStorageCapabilities = {
  readonly syncRead: boolean;
  readonly binary: boolean;
  readonly records: boolean;
  readonly transactions: boolean;
  readonly iteration: boolean;
  /** 单值近似上限，字节。cookie ~4096，localStorage ~5MB，IndexedDB 为 undefined（受配额而非单值限制）。 */
  readonly maxValueBytes: number | undefined;
  /** 该后端上不可见的键是否可能存在（cookies 的 HttpOnly）。 */
  readonly opaqueEntries: boolean;
};

/** Snapshot a capability descriptor once; invalid or throwing accessors return undefined. */
export const snapshotStorageCapabilities = (value: unknown): IStorageCapabilities | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  let syncRead: unknown;
  let binary: unknown;
  let records: unknown;
  let transactions: unknown;
  let iteration: unknown;
  let maxValueBytes: unknown;
  let opaqueEntries: unknown;
  try {
    syncRead = candidate.syncRead;
    binary = candidate.binary;
    records = candidate.records;
    transactions = candidate.transactions;
    iteration = candidate.iteration;
    maxValueBytes = candidate.maxValueBytes;
    opaqueEntries = candidate.opaqueEntries;
  } catch {
    return undefined;
  }
  if (
    [syncRead, binary, records, transactions, iteration, opaqueEntries].some(
      (entry) => typeof entry !== 'boolean'
    ) ||
    (maxValueBytes !== undefined &&
      (typeof maxValueBytes !== 'number' ||
        !Number.isSafeInteger(maxValueBytes) ||
        maxValueBytes < 0))
  )
    return undefined;
  return {
    syncRead: syncRead as boolean,
    binary: binary as boolean,
    records: records as boolean,
    transactions: transactions as boolean,
    iteration: iteration as boolean,
    maxValueBytes: maxValueBytes as number | undefined,
    opaqueEntries: opaqueEntries as boolean
  };
};

/** Validate the complete runtime capability descriptor shared by public boundaries. */
export const isStorageCapabilities = (value: unknown): value is IStorageCapabilities =>
  snapshotStorageCapabilities(value) !== undefined;
