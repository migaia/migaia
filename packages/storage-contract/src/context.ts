import type { IAbortSignal } from '@migaia/utils/promise'

/**
 * Supplies cooperative cancellation and timeouts as an optional final argument to storage
 * operations.
 */
export type IOperationContext = {
  /**
   * Requests cooperative cancellation. Backends can ignore work cancellation, while
   * cancellation-aware operations stop waiting with the contract `ABORTED` error. Uses a structural
   * signal without depending on the global `AbortSignal`.
   */
  readonly signal?: IAbortSignal
  /**
   * Creates an internal timeout signal. When an external `signal` also exists, the first signal to
   * fire wins.
   */
  readonly timeoutMs?: number
  /** IndexedDB iterator page size; bounded to protect cursor memory. */
  readonly pageSize?: number
}

export const ConflictPolicy = Object.freeze({
  conflict: 'conflict',
  replace: 'replace'
} as const)

export type IConflictPolicy = (typeof ConflictPolicy)[keyof typeof ConflictPolicy]

export type IWriteOptions = IOperationContext & {
  readonly conflictPolicy?: IConflictPolicy
}

/** Synchronous writes cannot honor cancellation or timeout fields. */
export type ISyncWriteOptions = {
  readonly conflictPolicy?: IConflictPolicy
}

/**
 * Identifies an L1 document. Corresponds to `IDBValidKey` on a structured backend such as
 * IndexedDB.
 */
export type IStorageKey = string | number | Date | ArrayBuffer | readonly IStorageKey[]

/**
 * Defines L1 query bounds with `IDBKeyRange` semantics. Avoids a direct dependency so other
 * structured backends can implement it.
 */
export type IKeyRange<TKey extends IStorageKey = IStorageKey> = {
  readonly lower?: TKey
  readonly lowerOpen?: boolean
  readonly upper?: TKey
  readonly upperOpen?: boolean
}
