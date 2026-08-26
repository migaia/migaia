import type { IConflictPolicy, IStorageKey } from './context.js'
import type { IBackendKind } from './capabilities.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'

export type ITransactionWriteOptions = {
  readonly conflictPolicy?: IConflictPolicy
}

/** Backend-neutral transaction scope shared by memory and IndexedDB commit engines. */
export type ITransactionScope<TValue = unknown> = {
  get(key: IStorageKey): Promise<TValue | undefined>
  put(value: TValue, key?: IStorageKey, options?: ITransactionWriteOptions): Promise<IStorageKey>
  delete(key: IStorageKey): Promise<void>
}

/** Validate transaction entry callbacks before a backend allocates snapshot/connection state. */
export const assertTransactionCallback = (run: unknown, backend: IBackendKind): void => {
  if (typeof run === 'function') return
  throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
    backend,
    cause: new TypeError('transaction callback must be a function')
  })
}

/** Validate and snapshot scope write options shared by both transaction engines. */
export const readTransactionConflictPolicy = (
  options: unknown,
  backend: IBackendKind
): IConflictPolicy => {
  if (options === undefined) return 'conflict'
  if (typeof options === 'object' && options !== null && !Array.isArray(options)) {
    let policy: unknown
    try {
      policy = (options as { conflictPolicy?: unknown }).conflictPolicy
    } catch (cause) {
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend,
        cause
      })
    }
    if (policy === undefined || policy === 'conflict') return 'conflict'
    if (policy === 'replace') return 'replace'
  }
  throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
    backend,
    cause: new TypeError('transaction write options contain an invalid conflictPolicy')
  })
}
