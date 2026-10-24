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
  commitUnknown: 'PostgreSQL commit result is unknown',
  invalidCursor: 'Invalid PostgreSQL change cursor',
  expiredCursor: 'PostgreSQL change cursor is no longer retained'
} as const
