/**
 * Tracked package-owned inventory used by the registry check when the workspace-local documentation
 * is ignored. The Luna evidence command separately reconciles this inventory with the canonical
 * registry.
 */
export const storageWebErrorCodeInventory = [
  'BACKEND_DISPOSE_FAILED',
  'BACKEND_UNAVAILABLE',
  'COOKIE_SCOPE_AMBIGUOUS',
  'DESERIALIZE_FAILED',
  'DUPLICATE_KEY',
  'EXTENSION_FAILED',
  'INDEX_BACKFILL_FAILED',
  'INDEX_BACKFILL_STALE',
  'INDEX_ORPHAN',
  'INDEX_QUERY_INVALIDATED',
  'INDEX_UNIQUE_CONFLICT',
  'INVALID_CONFIG',
  'INDEXED_DB_FEATURE_NOT_INSTALLED',
  'LIVE_QUERY_DISPOSE_FAILED',
  'LIVE_QUERY_DISPOSED',
  'QUOTA_EXCEEDED',
  'SERIALIZE_FAILED',
  'REACTIVE_ADAPTER_DISPOSE_FAILED',
  'REACTIVE_ADAPTER_FAILED',
  'REACTIVE_ADAPTER_NOT_INSTALLED',
  'REACTIVE_FEATURE_INVALID',
  'TRANSACTION_FAILED',
  'VALUE_TOO_LARGE',
  'VERSION_UNSUPPORTED',
  'WRITE_FAILED'
] as const
