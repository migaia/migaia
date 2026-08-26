/** Conflict policies shared by storage contract implementations. */
export const StorageContractConflictPolicy = {
  conflict: 'conflict',
  replace: 'replace'
} as const

export type IStorageContractConflictPolicy =
  (typeof StorageContractConflictPolicy)[keyof typeof StorageContractConflictPolicy]
