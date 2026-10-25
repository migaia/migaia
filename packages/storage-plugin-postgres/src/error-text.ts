/** Stable diagnostics for the registered PostgreSQL boundaries and their validation causes. */
export const PostgresErrorText = {
  sqlFailed: 'PostgreSQL operation failed',
  decodeFailed: 'PostgreSQL storage value could not be decoded',
  transactionFailed: 'PostgreSQL transaction failed',
  duplicateKey: 'PostgreSQL storage channel conflict',
  invalidArgument: 'Invalid PostgreSQL storage argument',
  invalidOptions: 'Invalid PostgreSQL backend options',
  invalidArray: 'Invalid PostgreSQL native array parameter',
  invalidRow: 'Invalid PostgreSQL result column',
  invalidIdentifier: 'Invalid PostgreSQL identifier',
  invalidServer: 'PostgreSQL server does not match the selected preset',
  unsupported: 'PostgreSQL capability is unavailable',
  /** Admission names the missing feed table so deployment can repair its publication membership. */
  publicationTableMissing: (publication: string, schema: string, table: string) =>
    `PostgreSQL publication "${publication}" is missing table "${schema}"."${table}"`,
  /** Admission names the disabled action because both TRUNCATE policies require its WAL event. */
  publicationOperationMissing: (publication: string, operation: string) =>
    `PostgreSQL publication "${publication}" does not publish ${operation}`,
  commitUnknown: 'PostgreSQL commit result is unknown',
  invalidCursor: 'Invalid PostgreSQL change cursor',
  expiredCursor: 'PostgreSQL change cursor is no longer retained',
  /** A selected persistent slot can retain unbounded WAL until its consumer confirms progress. */
  unlimitedSlotWal:
    'PostgreSQL replication slot has unlimited WAL retention (max_slot_wal_keep_size=-1)'
} as const
