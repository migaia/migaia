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
  /** Private evidence is written beside business data before the same actual COMMIT. */
  markerValue: '1',
  /** External WAL evidence outlives the separate short-lived lost-COMMIT acknowledgement marker. */
  journalMarkerNamespace: 'storage.journal.commit',
  /** Metadata images borrow one canonical private tuple in the existing record lock owner. */
  metadataLockNamespace: 'storage.postgres.metadata',
  /** Metadata revisions remain distinct from business-channel canonical lock identities. */
  metadataRevisionPrefix: 'metadata:',
  vectorConfiguration: 'vector_config',
  /** Global physical collection schema is not a business org and cannot be deleted by dropOrg. */
  vectorConfigurationOwner: '00000000-0000-0000-0000-000000000000',
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

/** Opt-in native expression layouts; this domain is never a second vector provider. */
export const PgQuantizedMode = { halfvec: 'halfvec', binary: 'binary_quantize' } as const
/** Stable native layout prefix keeps expression index identities within PostgreSQL's name limit. */
export const PgQuantizedIndexPrefix = 'storage_q_'
/** The replication policy either invalidates the route or leaves TRUNCATE for manual handling. */
export const PgTruncatePolicy = { reset: 'reset', block: 'block' } as const
export type PgTruncatePolicy = keyof typeof PgTruncatePolicy
