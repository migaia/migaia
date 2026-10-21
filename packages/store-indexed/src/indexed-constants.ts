/** Indexed store collection operation names used by diagnostics and registries. */
export const IndexedOperation = {
  /** Diagnostic category for reading collection data without changing it. */
  read: 'read',
  /** Diagnostic category for inserting or updating collection data. */
  write: 'write',
  /** Diagnostic category for removing collection data. */
  delete: 'delete'
} as const

/** Public diagnostic operation values; these labels do not themselves perform collection actions. */
export type IIndexedOperation = (typeof IndexedOperation)[keyof typeof IndexedOperation]
