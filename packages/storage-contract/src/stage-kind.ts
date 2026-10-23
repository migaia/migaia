/** Canonical discriminants distinguish neutral observer families without granting resource access. */
export const StorageStageKind = {
  codec: 'codec',
  query: 'query',
  transaction: 'transaction',
  backend: 'backend',
  sql: 'sql',
  operation: 'operation',
  concurrency: 'concurrency'
} as const

/** Stable observer family domain shared by the original contract and host owners. */
export type StorageStageKind = keyof typeof StorageStageKind
