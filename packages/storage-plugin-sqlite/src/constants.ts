/** Public backend identity and physical suffixes are shared by schema, queries and diagnostics. */
export const SqliteNames = {
  backend: 'sqlite',
  table: 'migaia',
  text: 'text',
  bytes: 'bytes',
  record: 'records',
  metadata: 'metadata',
  locks: 'locks',
  revisions: 'revisions',
  journal: 'journal',
  /** Private lifetime reservations are distinct from the shared journal's commit head locks. */
  journalOwner: 'storage.sqlite.journal.owner',
  markers: 'commit_markers'
} as const
/** Trusted native control statements bypass only the public SQL composition entry. */
export const SqliteControl = {
  begin: 'BEGIN IMMEDIATE',
  deferred: 'BEGIN DEFERRED',
  commit: 'COMMIT',
  rollback: 'ROLLBACK',
  journal: 'PRAGMA journal_mode',
  wal: 'PRAGMA journal_mode=WAL',
  busy: 'PRAGMA busy_timeout=0',
  databases: 'PRAGMA database_list',
  generatedKey: 'SELECT lower(hex(randomblob(16))) AS key'
} as const
/** Native cache and polling sizes stay bounded without another scheduler or retry policy. */
export const SqliteLimits = { cache: 64, pollMs: 10, maxLockMs: 30_000, batch: 900 } as const
/** Operation identity feeds the existing host pipeline and observation registry. */
export const SqliteOperation = {
  get: 'get',
  set: 'set',
  remove: 'remove',
  has: 'has',
  keys: 'keys',
  clearValues: 'clearValues',
  clearAll: 'clearAll',
  /** Physical organization deletion stays under the native guarded mutation owner. */
  dropOrg: 'dropOrg',
  getBytes: 'getBytes',
  setBytes: 'setBytes',
  removeBytes: 'removeBytes',
  clearBytes: 'clearBytes',
  getRecord: 'getRecord',
  putRecord: 'putRecord',
  deleteRecord: 'deleteRecord',
  clearRecords: 'clearRecords',
  iterateRecords: 'iterateRecords',
  next: 'iterateRecords.next',
  metadataGet: 'metadata.get',
  metadataSet: 'metadata.set',
  metadataDelete: 'metadata.delete',
  sql: 'sql',
  transaction: 'transaction',
  getMany: 'getMany',
  setMany: 'setMany',
  removeMany: 'removeMany',
  removeByPrefix: 'removeByPrefix',
  ttlExpire: 'ttl.expire',
  ttlRemaining: 'ttl.remaining',
  ttlPersist: 'ttl.persist',
  counterIncrement: 'counter.increment'
} as const
/** Quote one complete physical identifier; caller values are always separately bound. */
export function quoteSqliteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
