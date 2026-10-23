/** Canonical host boundary codes. */
export const StorageErrorCode = {
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
   * A host mutation was requested while another install batch is active. Callers must wait for that
   * batch to settle and explicitly retry.
   */
  storageHostBusy: 'STORAGE_HOST_BUSY',
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
  /** A backend token does not match the installed store or selected Feature. */
  backendKindMismatch: 'BACKEND_KIND_MISMATCH',
  /** Schema or codec configuration is malformed; repair its descriptor before retrying. */
  invalidConfig: 'INVALID_CONFIG',
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
  /** A user extension failed; inspect its original cause and operation context before retrying. */
  extensionFailed: 'EXTENSION_FAILED'
} as const

export type IStorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode]
