import type { IConflictPolicy, IStorageKey } from './context.js'
import type { IBackendKind } from './capabilities.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'

/** Reduced write options used inside a backend-owned transaction scope. */
export type ITransactionWriteOptions = {
  /**
   * Conflict rejects an existing key; replace permits overwrite. Omission is interpreted as
   * conflict.
   */
  readonly conflictPolicy?: IConflictPolicy
}

/**
 * Record operations exposed only for the duration of a provider's transaction callback. Do not
 * retain the scope after that callback settles. Isolation, commit scheduling, and retries are
 * implementation-defined; this contract does not allocate a transaction or connection.
 */
export type ITransactionScope<TValue = unknown> = {
  /** Reads a record inside this scope; missing keys resolve to undefined. */
  get(key: IStorageKey): Promise<TValue | undefined>
  /** Writes inside this scope and returns its key; omitted keys request provider-defined generation. */
  put(value: TValue, key?: IStorageKey, options?: ITransactionWriteOptions): Promise<IStorageKey>
  /** Removes one record inside this scope. */
  delete(key: IStorageKey): Promise<void>
}

/**
 * Rejects a non-callable transaction callback before a provider allocates transaction resources.
 * Valid functions return without being invoked. Invalid input throws INVALID_ARGUMENT with the
 * supplied backend label and a native TypeError cause; this does not validate callback results.
 */
export const assertTransactionCallback = (run: unknown, backend: IBackendKind): void => {
  if (typeof run === 'function') return
  throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
    backend,
    cause: new TypeError('transaction callback must be a function')
  })
}

/**
 * Reads one transaction write policy before the provider changes records. Omitted options or an
 * omitted conflictPolicy return conflict; the only other accepted value is replace. Invalid
 * shapes/policies throw INVALID_ARGUMENT with the supplied backend label. Accessor or reflection
 * failure remains reachable as cause. No transaction or storage operation is started.
 */
export const readTransactionConflictPolicy = (
  options: unknown,
  backend: IBackendKind
): IConflictPolicy => {
  if (options === undefined) return 'conflict'
  try {
    if (typeof options === 'object' && options !== null && !Array.isArray(options)) {
      /** Capture the policy once so accessors cannot change it between validation and use. */
      const policy = (options as { conflictPolicy?: unknown }).conflictPolicy
      if (policy === undefined || policy === 'conflict') return 'conflict'
      if (policy === 'replace') return 'replace'
    }
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend,
      cause
    })
  }
  throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
    backend,
    cause: new TypeError('transaction write options contain an invalid conflictPolicy')
  })
}
