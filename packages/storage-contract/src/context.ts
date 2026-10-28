import type { IAbortSignal } from '@migaia/utils/promise'
import type { IWriteConcurrencyOptions } from './concurrency.ts'

/**
 * Optional final argument for asynchronous storage operations. The contract validates its shape;
 * the backend owns cancellation, timers, paging, and the actual operation outcome.
 */
export type IOperationContext = {
  /**
   * Requests cooperative cancellation. Backends can ignore work cancellation, while
   * cancellation-aware operations stop waiting with the contract `ABORTED` error. Uses a structural
   * signal without depending on the global `AbortSignal`.
   */
  readonly signal?: IAbortSignal
  /**
   * Optional non-negative safe-integer timeout in milliseconds. The backend creates any timer or
   * combined signal it needs; this contract package creates neither. Omission leaves timing to the
   * implementation rather than supplying a default duration.
   */
  readonly timeoutMs?: number
  /** Optional iterator page-size hint: an integer from 1 through 4096. No default is inserted here. */
  readonly pageSize?: number
  /**
   * Optional canonical lowercase UUID supplied by an outer host. The contract preserves omission;
   * the host chooses the default organization and owns namespace mapping.
   */
  readonly orgId?: string
}

/** Frozen write-conflict choices shared by asynchronous, synchronous, and transaction contracts. */
export const ConflictPolicy = Object.freeze({
  /** Default transaction policy: reject an existing key instead of replacing it. */
  conflict: 'conflict',
  /** Explicitly permit replacing an existing value under the same key. */
  replace: 'replace'
} as const)

/** Supported conflict-policy values; omitted transaction policy is interpreted as conflict. */
export type IConflictPolicy = (typeof ConflictPolicy)[keyof typeof ConflictPolicy]

/** Asynchronous operation context plus an optional write-conflict choice. */
export type IWriteOptions = IOperationContext &
  IWriteConcurrencyOptions & {
    /**
     * Optional conflict or replace policy. Context snapshots preserve omission; the provider
     * applies defaults.
     */
    readonly conflictPolicy?: IConflictPolicy
  }

/** Synchronous writes cannot honor cancellation or timeout fields. */
export type ISyncWriteOptions = {
  /**
   * Optional conflict or replace choice; this reduced shape accepts no cancellation or timeout
   * control.
   */
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
  /** Optional lower key bound. Omit for no lower bound; validate keys before backend use. */
  readonly lower?: TKey
  /** Whether the lower endpoint is excluded; omitted means a closed endpoint under range semantics. */
  readonly lowerOpen?: boolean
  /** Optional upper key bound; omission leaves the range unbounded above. */
  readonly upper?: TKey
  /** Whether the upper endpoint is excluded; omitted means a closed endpoint under range semantics. */
  readonly upperOpen?: boolean
}
