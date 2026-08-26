/**
 * Tracked package-owned inventory used by T31 when the workspace-local documentation is ignored.
 * The Luna evidence command separately reconciles this inventory with the canonical SDD registry.
 */
export const storageWebErrorCodeInventory = [
  'BACKEND_UNAVAILABLE',
  'COOKIE_SCOPE_AMBIGUOUS',
  'DESERIALIZE_FAILED',
  'DUPLICATE_KEY',
  'EXTENSION_FAILED',
  'INDEX_BACKFILL_STALE',
  'INDEX_ORPHAN',
  'INDEX_QUERY_INVALIDATED',
  'INDEX_UNIQUE_CONFLICT',
  'INVALID_CONFIG',
  'LIVE_QUERY_DISPOSED',
  'MIGRATION_FAILED',
  'QUOTA_EXCEEDED',
  'SERIALIZE_FAILED',
  'TRANSACTION_CONFLICT',
  'TRANSACTION_FAILED',
  'VALIDATION_FAILED',
  'VALUE_TOO_LARGE',
  'VERSION_UNSUPPORTED',
  'WRITE_FAILED'
] as const
