/**
 * Defines the error codes owned by `@migaia/storage-web` in one place.
 *
 * The `(source, code)` pair uniquely identifies one public semantic failure. `source` is always
 * `@migaia/storage-web`. Throw sites reference these constants rather than inline literals.
 *
 * Code values are public API, so renaming one is a breaking change. Five contract codes move to
 * `@migaia/storage-contract`: `UNSUPPORTED_CAPABILITY`, `ABORTED`, `STORE_DISPOSED`,
 * `INVALID_ARGUMENT`, and `INVALID_KEY`. `INVALID_CONFIG` covers web adapter configuration
 * validation.
 */
export const StorageErrorCode = Object.freeze({
  /**
   * A storage backend is unavailable because a private-mode probe fails or localStorage, IndexedDB,
   * or `document` is disabled or missing.
   *
   * The caller selects another installed backend or asks the user to enable storage access, rather
   * than retrying the same unavailable backend. Enforces the availability probe contract.
   */
  unavailable: 'BACKEND_UNAVAILABLE',

  /**
   * A write reaches the browser quota, such as `QuotaExceededError` or Firefox's
   * `NS_ERROR_DOM_QUOTA_REACHED`.
   *
   * The caller removes unneeded data or selects IndexedDB. The failure persists until storage
   * conditions change.
   */
  quotaExceeded: 'QUOTA_EXCEEDED',

  /**
   * A serialized cookie assignment exceeds the 4 KB limit.
   *
   * The caller shortens the value, name, or attributes, or stores the data in IndexedDB. The
   * library does not silently truncate the assignment.
   */
  valueTooLarge: 'VALUE_TOO_LARGE',

  /**
   * A native IndexedDB record or byte write fails while snapshotting its payload with
   * `structuredClone`, before asynchronous admission or physical mutation.
   *
   * The caller checks whether the value can be serialized. This is a data shape failure rather than
   * a backend failure.
   */
  serializeFailed: 'SERIALIZE_FAILED',

  /**
   * A decoded IndexedDB cross-instance notification contains an invalid encoded key hint.
   *
   * The caller checks whether an external writer or newer version changes the stored data.
   */
  deserializeFailed: 'DESERIALIZE_FAILED',

  /**
   * A transaction or exclusive entity commit fails, including IndexedDB creation/commit, host
   * coordination, or a callback error outside the storage error family.
   *
   * The caller checks whether the transaction crosses the automatic commit boundary or its scope
   * escapes. Transient concurrency failures can be retried.
   */
  transactionFailed: 'TRANSACTION_FAILED',

  /**
   * A logical key conflicts across the value, bytes, and record channels without `conflictPolicy:
   * 'replace'`.
   *
   * The caller changes the key or explicitly selects `replace` to atomically remove the same key
   * from other channels.
   */
  duplicateKey: 'DUPLICATE_KEY',

  /**
   * The native IndexedDB schema version exceeds the version known to the current adapter.
   *
   * The caller upgrades the code or downgrades the data. Older code must not misread or overwrite
   * data from a newer version.
   */
  versionUnsupported: 'VERSION_UNSUPPORTED',

  /**
   * An extension such as schema, codec, `namespaceCodec`, comparator, or diagnostic throws an
   * unclassified exception.
   *
   * The caller checks the extension implementation. `extensionStage` identifies the failed
   * extension, and `cause` retains the original exception.
   */
  extensionFailed: 'EXTENSION_FAILED',

  /**
   * A cookie is not visible after a write because the browser silently rejects it.
   *
   * The caller checks cookie attributes (`path`, `domain`, `SameSite`, and `secure`) and capacity.
   * Privacy policies may still remove the cookie asynchronously.
   */
  writeFailed: 'WRITE_FAILED',

  /**
   * Multiple visible cookie scopes share a name, so the target value's scope is ambiguous.
   *
   * The caller gives each scope a unique cookie name or fixes the scope at construction to avoid
   * ambiguity.
   */
  cookieScopeAmbiguous: 'COOKIE_SCOPE_AMBIGUOUS',

  /**
   * Web adapter input or configuration validation fails. Covers cookie `SameSite`, `Secure`,
   * `Partitioned`, and scope settings; IndexedDB factory, store names, and `IDBKeyRange`; namespace
   * codecs; and browser backend options.
   *
   * Contract shape validation uses `storage-contract`'s `INVALID_ARGUMENT`. This code covers
   * adapter configuration only, as a local exception to unified argument validation.
   *
   * The caller corrects the configuration before retrying. The argument or configuration failure
   * persists until it changes.
   */
  invalidConfig: 'INVALID_CONFIG',

  /**
   * IndexedDB sidecar contains an index row whose authoritative record is absent. Callers should
   * repair or rebuild the index rather than treating the skipped row as a successful query result.
   */
  indexOrphan: 'INDEX_ORPHAN',

  /**
   * An indexed mutation would assign one logical unique key to two authoritative records.
   * Uniqueness is enforced inside the record/sidecar transaction; callers must choose a different
   * indexed value or remove the competing record before retrying.
   */
  indexUniqueConflict: 'INDEX_UNIQUE_CONFLICT',

  /**
   * A native `iterateRecordIndex` page observed the global or scope mutation epoch change between
   * pages. Each page validates a short readonly transaction, then closes it before yielding;
   * callers must restart the query rather than trust a mixed snapshot.
   */
  indexQueryInvalidated: 'INDEX_QUERY_INVALIDATED',

  /**
   * A live-query consumer attempted to refresh after terminal disposal. Disposal cannot revive
   * subscriptions or owned reactive state; callers must create a new live query instead of reusing
   * the disposed handle.
   */
  liveQueryDisposed: 'LIVE_QUERY_DISPOSED',

  /**
   * A backfill operation presented an expired owner, stale generation, or conflicting checkpoint.
   * The batch must be rejected and rolled back; callers should retry through a fresh repository
   * operation after the current handle is reacquired.
   */
  indexBackfillStale: 'INDEX_BACKFILL_STALE',

  /**
   * Secondary-index backfill failed and persisting its failed readiness also failed. The caller
   * inspects the native aggregate's original cause/errors before retrying; neither the primary
   * failure nor the persistence failure may be discarded.
   */
  indexBackfillFailed: 'INDEX_BACKFILL_FAILED',

  /**
   * Live-query request or owned reactive cleanup collected one or more failures. Callers must treat
   * the query as terminal and inspect AggregateError.errors.
   */
  liveQueryDisposeFailed: 'LIVE_QUERY_DISPOSE_FAILED',

  /**
   * A reactive feature descriptor, brand, provider seam, or adapter result is invalid. Callers must
   * correct the exact feature/backend pairing before retrying.
   */
  reactiveFeatureInvalid: 'REACTIVE_FEATURE_INVALID',

  /**
   * The requested backend lacks its reactive adapter or is not installed. Callers must use an
   * installed adapter-bound backend ID, with no default fallback.
   */
  reactiveAdapterNotInstalled: 'REACTIVE_ADAPTER_NOT_INSTALLED',

  /**
   * A reactive adapter event, poll, or authoritative read failed. Callers should observe the query
   * error state and allow a later invalidation or poll to recover.
   */
  reactiveAdapterFailed: 'REACTIVE_ADAPTER_FAILED',

  /**
   * Reactive adapter, poller, query, or service cleanup collected failures. Callers must treat the
   * adapter as terminal and inspect AggregateError.errors.
   */
  reactiveAdapterDisposeFailed: 'REACTIVE_ADAPTER_DISPOSE_FAILED',

  /**
   * Direct backend quiescence, transport, connection, or channel cleanup collected failures.
   * Callers must treat the backend as terminal and inspect all errors.
   */
  backendDisposeFailed: 'BACKEND_DISPOSE_FAILED'
} as const)

/** Semantic failure code owned by storage-web; shared contract failures keep their own source. */
export type IStorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode]
