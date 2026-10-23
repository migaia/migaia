/** Package-owned native identities keep tables, operations and diagnostics consistent. */
export const PgNames = {
  backend: 'postgres',
  schema: 'public',
  prefix: 'migaia',
  text: 'kv',
  bytes: 'bytes',
  record: 'records',
  metadata: 'meta',
  revisions: 'revisions',
  locks: 'locks',
  journal: 'journal',
  markers: 'commit_markers',
  vectorConfiguration: 'vector_config',
  /** Global physical collection schema is not a business org and cannot be deleted by dropOrg. */
  vectorConfigurationOwner: 'storage.backend.postgres/vector-config',
  notify: 'changes'
} as const
/** Only physical serialization/deadlock states enter the original revision classification path. */
export const PgSqlState = {
  serialization: '40001',
  deadlock: '40P01',
  unique: '23505',
  abortedTransaction: '25P02'
} as const
/** All stores share bounded invalidation hints; immutable schema/prefix fields route each hint. */
export const PgNotificationChannel = 'migaia_storage_changes'
/** Public operations enter the existing host pipeline using these package-owned names. */
export const PgOperation = {
  get: 'get',
  set: 'set',
  remove: 'remove',
  has: 'has',
  keys: 'keys',
  clearValues: 'clearValues',
  clearAll: 'clearAll',
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
  counterIncrement: 'counter.increment',
  inspectLocks: 'inspectLocks',
  watch: 'watch',
  notify: 'notify',
  copy: 'copy.from',
  readChanges: 'durableChangeFeed.readChanges',
  tailChanges: 'durableChangeFeed.tailChanges',
  dropOrg: 'org.drop'
} as const
