/**
 * Defines the error codes owned by `@migaia/storage-web` in one place.
 *
 * The `(source, code)` pair uniquely identifies an error under `docs/contracts/error-codes.md`.
 * `source` is always `@migaia/storage-web`. Throw sites reference these constants rather than
 * inline literals.
 *
 * Code values are public API, so renaming one is a breaking change. Five contract codes move to
 * `@migaia/storage-contract`: `UNSUPPORTED_CAPABILITY`, `ABORTED`, `STORE_DISPOSED`,
 * `INVALID_ARGUMENT`, and `INVALID_KEY`. `INVALID_CONFIG` covers web adapter configuration
 * validation. See `docs/store-persist/storage-web-integration.sdd.md` §4.2.
 */
export const StorageErrorCode = Object.freeze({
  /**
   * A storage backend is unavailable because a private-mode probe fails or localStorage, IndexedDB,
   * or `document` is disabled or missing.
   *
   * The caller selects `memoryStorageHost` explicitly or asks the user to enable storage access,
   * rather than retrying the same unavailable backend. Enforces the availability probe contract in
   * §10.1.
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
   * Serialization fails because `JSON.stringify` throws, codec `encode` returns unexpected output,
   * or a memory write fails during `structuredClone`.
   *
   * The caller checks whether the value can be serialized. This is a data shape failure rather than
   * a backend failure.
   */
  serializeFailed: 'SERIALIZE_FAILED',

  /**
   * Deserialization fails because `JSON.parse` throws, an envelope is malformed, or codec `decode`
   * returns unexpected output.
   *
   * The caller checks whether an external writer or newer version changes the stored data.
   * `onInvalid` handles the `decode` stage.
   */
  deserializeFailed: 'DESERIALIZE_FAILED',

  /**
   * Schema validation fails because `ISchemaAdapter.validate` throws. The Standard Schema adapter
   * converts returned issues into a validation failure.
   *
   * The caller corrects the data to match the schema. `onInvalid` handles the `validate` stage.
   */
  validationFailed: 'VALIDATION_FAILED',

  /**
   * A migration function fails.
   *
   * Failure to migrate one record does not affect other records. The caller isolates the failure at
   * the `migrate` stage or repairs the migration logic.
   */
  migrationFailed: 'MIGRATION_FAILED',

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
   * Entity envelope `__v` or the IndexedDB schema version exceeds the version known to the current
   * code.
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
   * A read revision, global epoch, or KV entity snapshot changes before its atomic/exclusive
   * commit, causing a concurrent write conflict.
   *
   * The caller reads again and retries the entire transaction. This is a retryable concurrency
   * conflict rather than data corruption.
   */
  transactionConflict: 'TRANSACTION_CONFLICT',

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
   * `Partitioned`, and scope settings; IndexedDB factory, store names, and `IDBKeyRange`;
   * migration, schema, entity, and namespace codecs; backend options; and `selectCodec`'s
   * `onDiagnostic`.
   *
   * Enforces `docs/store-persist/storage-web-integration.sdd.md` §4.2/D-13. Contract shape
   * validation uses `storage-contract`'s `INVALID_ARGUMENT`. This code covers adapter configuration
   * only, as a local exception to unified argument validation in `error-code-rollout.sdd.md` §3.
   *
   * The caller corrects the configuration before retrying. The argument or configuration failure
   * persists until it changes.
   */
  invalidConfig: 'INVALID_CONFIG',

  /**
   * IndexedDB sidecar contains an index row whose authoritative record is absent. Enforces the V2
   * orphan-reporting rule; callers should repair or rebuild the index rather than treating the
   * skipped row as a successful query result.
   */
  indexOrphan: 'INDEX_ORPHAN',

  /**
   * An indexed mutation would assign one logical unique key to two authoritative records. Enforces
   * storage-v2 SWV2-E04 inside the record/sidecar transaction; callers must choose a different
   * indexed value or remove the competing record before retrying.
   */
  indexUniqueConflict: 'INDEX_UNIQUE_CONFLICT',

  /**
   * A native `iterateRecordIndex` page observed the global or scope mutation epoch change between
   * pages. Enforces storage-v2 SWV2-E19/D26: each page validates a short readonly transaction, then
   * closes it before yielding; callers must restart the query rather than trust a mixed snapshot.
   */
  indexQueryInvalidated: 'INDEX_QUERY_INVALIDATED',

  /**
   * A live-query consumer attempted to refresh after its terminal disposal. Enforces storage-v2
   * SWV2-E12: disposal cannot revive subscriptions or owned reactive state; callers must create a
   * new live query instead of reusing the disposed handle.
   */
  liveQueryDisposed: 'LIVE_QUERY_DISPOSED',

  /**
   * A backfill operation presented an expired owner, stale generation, or conflicting checkpoint.
   * Enforces storage-v2 SWV2-E15/E18: the batch must be rejected and rolled back; callers should
   * retry through a fresh repository operation after the current handle is reacquired.
   */
  indexBackfillStale: 'INDEX_BACKFILL_STALE',

  /**
   * Secondary-index backfill failed and persisting its failed readiness also failed. The caller
   * inspects the native aggregate's original cause/errors before retrying; neither the primary
   * failure nor the persistence failure may be discarded.
   */
  indexBackfillFailed: 'INDEX_BACKFILL_FAILED',

  /**
   * A backend definition contains an invalid identifier. Enforces SWV4-E15/D51; callers must
   * correct the bounded backend ID before retrying installation.
   */
  backendIdInvalid: 'BACKEND_ID_INVALID',

  /**
   * A backend ID is already present in the host install batch or registry. Enforces SWV4-E15/D23;
   * callers must use a distinct ID or wait for the existing batch before retrying.
   */
  backendDuplicate: 'BACKEND_DUPLICATE',

  /**
   * A lookup requested a valid backend ID that has not been installed. Enforces SWV4-E15/D17;
   * callers must install that exact backend or select an installed ID.
   */
  backendNotInstalled: 'BACKEND_NOT_INSTALLED',

  /**
   * A backend plugin or store failed its runtime contract check. Enforces SWV4-E16/D25; callers
   * must repair the plugin definition rather than relying on an unvalidated store.
   */
  backendPluginInvalid: 'BACKEND_PLUGIN_INVALID',

  /**
   * Backend creation, preparation, or PluginHost installation failed. Enforces SWV4-E17/D30;
   * callers may retry after fixing the cause, while the failed batch remains unpublished.
   */
  backendInstallFailed: 'BACKEND_INSTALL_FAILED',

  /**
   * A host mutation was requested while another install batch is active. Enforces SWV4-E36/D82;
   * callers must wait for that batch to settle and explicitly retry.
   */
  storageHostBusy: 'STORAGE_HOST_BUSY',

  /**
   * A host or its public operation was used after sealing or terminal disposal. Enforces
   * SWV4-E19/E35/D73; callers must create a new host instead of reviving this one.
   */
  storageHostDisposed: 'STORAGE_HOST_DISPOSED',

  /**
   * Host cleanup collected one or more failures. Enforces SWV4-E20/D18; callers must treat the host
   * as terminal while inspecting the aggregate errors for cleanup diagnostics.
   */
  storageHostDisposeFailed: 'STORAGE_HOST_DISPOSE_FAILED',

  /**
   * Live-query request or owned reactive cleanup collected one or more failures. Enforces
   * SWV4-E26/D70; callers must treat the query as terminal and inspect AggregateError.errors.
   */
  liveQueryDisposeFailed: 'LIVE_QUERY_DISPOSE_FAILED',

  /**
   * A reactive feature descriptor, brand, provider seam, or adapter result is invalid. Enforces
   * SWV4-E29/D69/D78; callers must correct the exact feature/backend pairing before retrying.
   */
  reactiveFeatureInvalid: 'REACTIVE_FEATURE_INVALID',

  /**
   * Reactive feature topology contains an unknown, duplicate, malformed, or cyclic node. Enforces
   * SWV4-E30/D71; callers must repair the feature set before any host mutation occurs.
   */
  reactiveTopologyInvalid: 'REACTIVE_TOPOLOGY_INVALID',

  /**
   * Host live-query service is not installed. Enforces SWV4-E31/D73; callers must install the
   * admitted reactive service before requesting a query.
   */
  reactiveServiceNotInstalled: 'REACTIVE_SERVICE_NOT_INSTALLED',

  /**
   * The requested backend lacks its reactive adapter or is not installed. Enforces SWV4-E32/D87;
   * callers must use an installed adapter-bound backend ID, with no default fallback.
   */
  reactiveAdapterNotInstalled: 'REACTIVE_ADAPTER_NOT_INSTALLED',

  /**
   * A reactive adapter event, poll, or authoritative read failed. Enforces SWV4-E33/D65; callers
   * should observe the query error state and allow a later invalidation or poll to recover.
   */
  reactiveAdapterFailed: 'REACTIVE_ADAPTER_FAILED',

  /**
   * Reactive adapter, poller, query, or service cleanup collected failures. Enforces SWV4-E34/D81;
   * callers must treat the adapter as terminal and inspect AggregateError.errors.
   */
  reactiveAdapterDisposeFailed: 'REACTIVE_ADAPTER_DISPOSE_FAILED',

  /**
   * Direct backend quiescence, transport, connection, or channel cleanup collected failures.
   * Enforces SWV4-E27/D16; callers must treat the backend as terminal and inspect all errors.
   */
  backendDisposeFailed: 'BACKEND_DISPOSE_FAILED'
} as const)

export type IStorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode]
