// Error code tables of every storage domain except storage.contract (see ../error-code.ts). Each
// table names its domain with `@error-source`; the registry reads that tag. Packages import their
// table from `@migaia/storage-contract/error-code` and declare no codes of their own.

/** Registered error domain of storage-host; never names the package or a path. */
export const STORAGE_HOST_ERROR_SOURCE = 'storage.host'

/**
 * Canonical host boundary codes.
 *
 * @error-source storage.host
 */
export const StorageHostErrorCode = {
  /** Journal configuration requires the explicit /journal plugin before backend installation. */
  journalNotAssembled: 'JOURNAL_NOT_ASSEMBLED',
  /** Notification construction requires an explicit controller factory or backend Feature. */
  changeControllerNotAssembled: 'CHANGE_CONTROLLER_NOT_ASSEMBLED',
  /** Change-feed calls require the explicit iterator Feature before creating an iterator. */
  changeIteratorNotAssembled: 'CHANGE_ITERATOR_NOT_ASSEMBLED',
  /**
   * A backend definition contains an invalid identifier. Callers must correct the bounded backend
   * ID before retrying installation.
   */
  backendIdInvalid: 'BACKEND_ID_INVALID',
  /**
   * A backend ID is already present in the host install batch or registry. Callers must use a
   * distinct ID or wait for the existing batch before retrying.
   */
  backendDuplicate: 'BACKEND_DUPLICATE',
  /**
   * A lookup requested a valid backend ID that has not been installed. Callers must install that
   * exact backend or select an installed ID.
   */
  backendNotInstalled: 'BACKEND_NOT_INSTALLED',
  /**
   * A backend plugin or store failed its runtime contract check. Callers must repair the plugin
   * definition rather than relying on an unvalidated store.
   */
  backendPluginInvalid: 'BACKEND_PLUGIN_INVALID',
  /**
   * Backend creation, preparation, or PluginHost installation failed. Callers may retry after
   * fixing the cause, while the failed batch remains unpublished.
   */
  backendInstallFailed: 'BACKEND_INSTALL_FAILED',
  /**
   * `host.unUse(id)` targeted a backend that another installed plugin still borrows through
   * `getPublishedBackend`, such as a cache tier or an archive source. Removing it would leave the
   * borrower with a closed store; callers must `unUse` the borrower first.
   */
  backendInUse: 'BACKEND_IN_USE',
  /**
   * A host or its public operation was used after sealing or terminal disposal. Callers must create
   * a new host instead of reviving this one.
   */
  storageHostDisposed: 'STORAGE_HOST_DISPOSED',
  /**
   * Host cleanup collected failures or a controlled backend finalizer rejected without a semantic
   * identity. Callers inspect the original cleanup cause and treat that resource as terminal.
   */
  storageHostDisposeFailed: 'STORAGE_HOST_DISPOSE_FAILED',
  /**
   * Some organization targets failed deletion after all targets were attempted; inspect errors and
   * retry.
   */
  orgDeleteFailed: 'ORG_DELETE_FAILED',
  /** A backend token does not match the installed store or selected Feature. */
  backendKindMismatch: 'BACKEND_KIND_MISMATCH',
  /** Schema or codec configuration is malformed; repair its descriptor before retrying. */
  invalidConfig: 'INVALID_CONFIG',
  /**
   * An entity optional operation or declaration lacks its explicit subpath Feature; install the
   * named unit before retrying.
   */
  entityFeatureRequired: 'ENTITY_FEATURE_REQUIRED',
  /** A schema rejects a value or returns invalid output; inspect the original validation cause. */
  validationFailed: 'VALIDATION_FAILED',
  /** Encoding rejects the value before backend I/O; inspect the codec failure on cause. */
  serializeFailed: 'SERIALIZE_FAILED',
  /** Decoding rejects a stored representation; retain the original data and inspect cause. */
  deserializeFailed: 'DESERIALIZE_FAILED',
  /** A different channel already owns this logical key; select replace to remove that owner. */
  duplicateKey: 'DUPLICATE_KEY',
  /** A projected unique index key belongs to a different record; repair the proposed commit. */
  indexUniqueConflict: 'INDEX_UNIQUE_CONFLICT',
  /** Backfill and persisting its failed readiness both failed; inspect every original cause. */
  indexBackfillFailed: 'INDEX_BACKFILL_FAILED',
  /** An entity migration step failed; retry only after correcting the original application cause. */
  migrationFailed: 'MIGRATION_FAILED',
  /** Stored entity data is newer than this definition; use a definition that understands it. */
  versionUnsupported: 'VERSION_UNSUPPORTED',
  /** A native memory transaction failed; inspect its original cause before retrying. */
  transactionFailed: 'TRANSACTION_FAILED',
  /** Private journal bytes are malformed; stop opening this journal and retain its original bytes. */
  journalRecordInvalid: 'JOURNAL_RECORD_INVALID',
  /** Recovery or a journal commit is uncertain; close this handle and reopen from its durable head. */
  journalRecoveryFailed: 'JOURNAL_RECOVERY_FAILED',
  /** Current value or full revision differs from the stored final image; no restore was written. */
  undoConflict: 'UNDO_CONFLICT',
  /** The selected target has no committed images for this txId; inspect the target and log. */
  undoNotFound: 'UNDO_NOT_FOUND',
  /** A user extension failed; inspect its original cause and operation context before retrying. */
  extensionFailed: 'EXTENSION_FAILED'
} as const

export type IStorageHostErrorCode = (typeof StorageHostErrorCode)[keyof typeof StorageHostErrorCode]

/** Registered error domain of storage-plugin-browser; never names the package or a path. */
export const STORAGE_BROWSER_ERROR_SOURCE = 'storage.backend.browser'

/**
 * Defines the error codes owned by `@migaia/storage-plugin-browser` in one place.
 *
 * The `(source, code)` pair uniquely identifies one public semantic failure; `source` is
 * `ERROR_SOURCE`. Throw sites reference these constants rather than inline literals.
 *
 * Code values are public API, so renaming one is a breaking change. Five contract codes move to
 * `@migaia/storage-contract`: `UNSUPPORTED_CAPABILITY`, `ABORTED`, `STORE_DISPOSED`,
 * `INVALID_ARGUMENT`, and `INVALID_KEY`. `INVALID_CONFIG` covers web adapter configuration
 * validation.
 *
 * @error-source storage.backend.browser
 */
export const StorageBrowserErrorCode = Object.freeze({
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
  backendDisposeFailed: 'BACKEND_DISPOSE_FAILED',

  /**
   * An optional IDB operation lacks its explicit Feature; install the named assembly before use.
   * Enforces round3 explicit assembly.
   */
  indexedDbFeatureNotInstalled: 'INDEXED_DB_FEATURE_NOT_INSTALLED'
} as const)

/**
 * Semantic failure code owned by storage-plugin-browser; shared contract failures keep their own
 * source.
 */
export type IStorageBrowserErrorCode =
  (typeof StorageBrowserErrorCode)[keyof typeof StorageBrowserErrorCode]

/** Registered error domain of storage-plugin-archive; never names the package or a path. */
export const STORAGE_ARCHIVE_ERROR_SOURCE = 'storage.backend.archive'

/**
 * Registered archive failures retain their original causes and certainly committed progress.
 *
 * @error-source storage.backend.archive
 */
export const ArchiveErrorCode = {
  /** Installation options cannot describe a valid archive; fix configuration before reinstalling. */
  invalidOption: 'INVALID_OPTION',
  /** A runtime key, rule or limit is invalid; no cold I/O has started. */
  invalidArgument: 'INVALID_ARGUMENT',
  /** An explicit archive operation failed; retry only after inspecting its cause and progress. */
  operationFailed: 'ARCHIVE_OPERATION_FAILED',
  /** Referenced segment or private metadata failed full validation; repair the stored archive. */
  segmentInvalid: 'ARCHIVE_SEGMENT_INVALID'
} as const
export type IArchiveErrorCode = (typeof ArchiveErrorCode)[keyof typeof ArchiveErrorCode]

/** Registered error domain of storage-plugin-cache; never names the package or a path. */
export const STORAGE_CACHE_ERROR_SOURCE = 'storage.backend.cache'

/**
 * Configuration and callback failures remain distinct from errors owned by borrowed backends.
 *
 * @error-source storage.backend.cache
 */
export const CacheErrorCode = {
  /**
   * Invalid tier, policy or propagation configuration; correct the configuration before
   * installation.
   */
  tierInvalid: 'CACHE_TIER_INVALID',
  /** The caller's loader or value encoding failed; inspect the original cause and retry explicitly. */
  loadFailed: 'CACHE_LOAD_FAILED',
  /** The caller's embedding function failed; inspect its cause without treating it as a cache miss. */
  embedFailed: 'CACHE_EMBED_FAILED'
} as const
export type ICacheErrorCode = (typeof CacheErrorCode)[keyof typeof CacheErrorCode]

/** Registered error domain of storage-plugin-object; never names the package or a path. */
export const STORAGE_OBJECT_ERROR_SOURCE = 'storage.backend.object'

/**
 * Native object failure categories preserve the original cause and actual commit boundary.
 *
 * @error-source storage.backend.object
 */
export const ObjectErrorCode = {
  /** Object I/O, signing or resource release failed; inspect cause before deciding whether to retry. */
  failed: 'OBJECT_FAILED',
  /** Stored pointer, sidecar or required native response is corrupt; do not treat it as missing. */
  dataInvalid: 'OBJECT_DATA_INVALID',
  /** The atomic commit was sent but acknowledgment is unknown; inspect head instead of replaying. */
  commitUnknown: 'OBJECT_COMMIT_UNKNOWN'
} as const
/** Stable union used by every native error constructor. */
export type IObjectErrorCode = (typeof ObjectErrorCode)[keyof typeof ObjectErrorCode]

/** Registered error domain of storage-plugin-postgres; never names the package or a path. */
export const STORAGE_POSTGRES_ERROR_SOURCE = 'storage.backend.postgres'

/**
 * Each code identifies one native or transaction boundary; original failures remain reachable.
 *
 * @error-source storage.backend.postgres
 */
export const PostgresErrorCode = {
  /** An uncategorized native query or connection failed; inspect its original cause. */
  sqlFailed: 'SQL_FAILED',
  /** A persisted canonical key, value or metadata row could not be decoded. */
  decodeFailed: 'DECODE_FAILED',
  /** A callback, accepted operation or transaction lifecycle failed and rolled back. */
  transactionFailed: 'TRANSACTION_FAILED',
  /** A known standard-channel write found the same key in an incompatible channel. */
  duplicateKey: 'DUPLICATE_KEY'
} as const
/** Public semantic codes belong to this domain rather than a driver SQLSTATE. */
export type IPostgresErrorCode = (typeof PostgresErrorCode)[keyof typeof PostgresErrorCode]

/** Registered error domain of storage-plugin-qdrant; never names the package or a path. */
export const STORAGE_QDRANT_ERROR_SOURCE = 'storage.backend.qdrant'

/**
 * Native protocol failures retain their original response or transport cause.
 *
 * @error-source storage.backend.qdrant
 */
export const QdrantErrorCode = {
  /** The native service or transport failed; a dispatched modification may have an unknown outcome. */
  unavailable: 'QDRANT_UNAVAILABLE',
  /** A native 4xx explicitly rejected the request; inspect the original response. */
  requestFailed: 'QDRANT_REQUEST_FAILED',
  /** A necessary native response field or managed envelope cannot be decoded. */
  responseInvalid: 'QDRANT_RESPONSE_INVALID'
} as const
export type IQdrantErrorCode = (typeof QdrantErrorCode)[keyof typeof QdrantErrorCode]

/** Registered error domain of storage-plugin-redis; never names the package or a path. */
export const STORAGE_REDIS_ERROR_SOURCE = 'storage.backend.redis'

/**
 * Each native failure retains its original cause and command execution evidence.
 *
 * @error-source storage.backend.redis
 */
export const RedisErrorCode = {
  /** Native command, connection or EXEC failure; unknown writes must never be replayed. */
  failed: 'REDIS_FAILED',
  /** Fixed protocol replies or persisted values cannot be decoded; inspect the original cause. */
  decodeFailed: 'DECODE_FAILED',
  /**
   * User callback, draft or finalizer failed without a native protocol failure; inspect the
   * original error.
   */
  transactionFailed: 'TRANSACTION_FAILED'
} as const
export type IRedisErrorCode = (typeof RedisErrorCode)[keyof typeof RedisErrorCode]

/** Registered error domain of storage-plugin-sparql; never names the package or a path. */
export const STORAGE_SPARQL_ERROR_SOURCE = 'storage.backend.sparql'

/**
 * Semantic identities distinguish definite protocol rejection from an unknown modification.
 *
 * @error-source storage.backend.sparql
 */
export const SparqlErrorCode = {
  /** Native result or RDF document cannot be decoded; inspect its original parse cause. */
  responseInvalid: 'SPARQL_RESPONSE_INVALID',
  /** Native reads failed through transport or server failure; retry only under caller policy. */
  unavailable: 'SPARQL_UNAVAILABLE',
  /** Native request was explicitly rejected; inspect its status and response body. */
  requestFailed: 'SPARQL_REQUEST_FAILED',
  /** Modification may have committed; verify the dataset before creating another writer. */
  commitUnknown: 'SPARQL_COMMIT_UNKNOWN',
  /**
   * A callback or accepted transaction business task failed before native commit; inspect its
   * cause.
   */
  transactionFailed: 'TRANSACTION_FAILED'
} as const
export type ISparqlErrorCode = (typeof SparqlErrorCode)[keyof typeof SparqlErrorCode]

/** Registered error domain of storage-plugin-sqlite; never names the package or a path. */
export const STORAGE_SQLITE_ERROR_SOURCE = 'storage.backend.sqlite'

/**
 * SQLite boundary codes keep native failures reachable through cause.
 *
 * @error-source storage.backend.sqlite
 */
export const SqliteErrorCode = {
  /** Native opening, SQL, schema or close failed; inspect the preserved cause. */
  sqliteFailed: 'SQLITE_FAILED',
  /** Transaction callback, ownership, commit or rollback failed. */
  transactionFailed: 'TRANSACTION_FAILED',
  /** Another public channel owns the same key; explicitly request replacement. */
  duplicateKey: 'DUPLICATE_KEY',
  /** Persisted data is damaged; preserve it and inspect the decoder cause. */
  decodeFailed: 'DECODE_FAILED'
} as const
/** Codes share the runtime table rather than independent string declarations. */
export type ISqliteErrorCode = (typeof SqliteErrorCode)[keyof typeof SqliteErrorCode]
