/** Stable package boundary messages never include SQL text, values or credentials. */
export const SqliteErrorText = {
  sqliteFailed: 'SQLite operation failed',
  transactionFailed: 'SQLite transaction failed or its view is no longer active',
  duplicateKey: 'another public storage channel owns this key',
  decodeFailed: 'stored SQLite data cannot be decoded',
  invalidOptions:
    'SQLite options require a synchronous driver and valid table, owner, wal and maxLockMs',
  malformedKey: 'stored SQLite key is not a canonical storage key',
  walUnavailable: 'SQLite cannot provide the requested recoverable journal mode',
  connectionClaimed: 'SQLite driver is already owned by an active store',
  closed: 'SQLite connection is closed',
  textValue: 'text storage value must be a string',
  byteValue: 'byte storage value must be a Uint8Array',
  batch: 'batch input requires valid unique keys and non-negative safe integer TTL values'
} as const
