/** Indexed store collection operation names used by diagnostics and registries. */
export const IndexedOperation = {
  read: 'read',
  write: 'write',
  delete: 'delete'
} as const

export type IIndexedOperation = (typeof IndexedOperation)[keyof typeof IndexedOperation]
