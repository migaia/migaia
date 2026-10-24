import type { IAbortSignal } from '@migaia/utils/promise'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { isStorageErrorFamily, type IStorageErrorFamily } from '../backends/errors.js'
import type { IStorageOperationRuntime } from '@migaia/storage-host/authoring/backend'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { normalizeStorageException } from './quota.js'
import { readAbortReason } from '@migaia/storage-host/authoring/backend'
import { snapshotOperationContext } from '@migaia/storage-host/authoring/context'
import { subscribeToAbort } from '../backends/errors.js'
import { StorageBackend } from '../constants.js'

/**
 * Converts IndexedDB requests and transactions to promises using the handling carried forward from
 * the earlier implementation. Writes wait for `transaction.oncomplete` rather than
 * `request.onsuccess`. Request success only means the request is accepted; quota failure, commit
 * failure, or abort can still roll back the transaction. Cancellation through `AbortSignal` is
 * cooperative. An individual `IDBRequest` cannot be undone, so cancellation discards its result.
 */
/**
 * Carries the runtime-neutral cancellation surface through IndexedDB helpers. The helpers only
 * subscribe/read cancellation state; they do not require DOM-only AbortSignal members, so retaining
 * the contract type keeps storage-web usable in non-DOM test consumers.
 */
export type IIdbOperationContext = { readonly signal?: IAbortSignal }

const normalizeTransactionAbort = (error: unknown): StorageError | StorageContractError => {
  const normalized = normalizeStorageException(error, StorageBackend.indexedDb)
  if (normalized.code === StorageErrorCode.quotaExceeded) return normalized
  return new StorageError(StorageErrorCode.transactionFailed, {
    backend: StorageBackend.indexedDb,
    cause: error
  })
}

export const normalizeIdbRequestFailure = (error: unknown): IStorageErrorFamily => {
  if (isStorageErrorFamily(error)) return error
  const normalized = normalizeStorageException(error, StorageBackend.indexedDb)
  return normalized.code === StorageErrorCode.quotaExceeded
    ? normalized
    : new StorageError(StorageErrorCode.transactionFailed, {
        backend: StorageBackend.indexedDb,
        cause: error
      })
}

/** Read the native transaction diagnostic selected by its terminal event. */
export const readIdbTransactionError = (transaction: IDBTransaction): unknown => transaction.error

/** Read the native result after the request has reported success. */
export const readIdbRequestResult = <T>(request: IDBRequest<T>): T => request.result

/** Read the native request diagnostic selected by its error event. */
export const readIdbRequestError = (request: IDBRequest): unknown => request.error

/** Read the native versionchange transaction while processing the upgrade event. */
export const readIdbOpenTransaction = (request: IDBOpenDBRequest): IDBTransaction | null =>
  request.transaction

/** Connect the native request's success and failure events. */
export const installIdbRequestHandlers = (
  request: IDBRequest,
  onSuccess: () => void,
  onError: () => void
): void => {
  request.onsuccess = onSuccess
  request.onerror = onError
}

/** Connect the native transaction's completion, failure and abort events. */
export const installIdbTransactionHandlers = (
  transaction: IDBTransaction,
  onComplete: () => void,
  onError: (event?: Event) => void,
  onAbort: () => void
): void => {
  transaction.oncomplete = onComplete
  transaction.onerror = onError
  transaction.onabort = onAbort
}

/** Connect the native database-open lifecycle before its first asynchronous event. */
export const installIdbOpenRequestHandlers = (
  request: IDBOpenDBRequest,
  onUpgradeNeeded: () => void,
  onBlocked: () => void,
  onSuccess: () => void,
  onError: () => void
): void => {
  request.onupgradeneeded = onUpgradeNeeded
  request.onblocked = onBlocked
  request.onsuccess = onSuccess
  request.onerror = onError
}

/** Wraps an `IDBRequest` in a promise and connects its cancellation signal. */
export function fromIdbRequest<T>(
  request: IDBRequest<T>,
  context: IIdbOperationContext | undefined,
  runtime: IStorageOperationRuntime
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const signal = snapshotOperationContext(context)?.signal
    /** Owns the active abort listener and remains a no-op before subscription returns. */
    let disposeAbort = (): void => {}
    const onAbort = (): void => {
      reject(
        new StorageContractError(StorageContractErrorCode.aborted, {
          backend: StorageBackend.indexedDb,
          cause: readAbortReason(signal)
        })
      )
    }
    try {
      installIdbRequestHandlers(
        request,
        () => {
          disposeAbort()
          try {
            resolve(readIdbRequestResult(request))
          } catch (cause) {
            reject(normalizeIdbRequestFailure(cause))
          }
        },
        () => {
          disposeAbort()
          try {
            reject(normalizeIdbRequestFailure(readIdbRequestError(request)))
          } catch (cause) {
            reject(normalizeIdbRequestFailure(cause))
          }
        }
      )
      disposeAbort = subscribeToAbort(signal, onAbort, runtime.reporter)
    } catch (cause) {
      disposeAbort()
      reject(normalizeIdbRequestFailure(cause))
    }
  })
}

/**
 * Waits for transaction commit before reporting write success. `request.onsuccess` only confirms
 * request acceptance, not persistence.
 */
export function idbTransactionCommit(
  transaction: IDBTransaction,
  context: IIdbOperationContext | undefined,
  runtime: IStorageOperationRuntime
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const signal = snapshotOperationContext(context)?.signal
    /** Records caller cancellation independently from later transaction abort events. */
    let cancelled = false
    /** Preserve the cancellation cause that selected the terminal outcome. */
    let abortReason: unknown
    /** Owns the active abort listener and remains a no-op before subscription returns. */
    let disposeAbort = (): void => {}
    /** Complete/error events can race cancellation; terminal selection happens once. */
    let settled = false
    /** Request errors are not terminal; retain their first diagnostic until native completion. */
    let firstFailure: IStorageErrorFamily | undefined
    /** Only successfully installed native terminal handlers can own asynchronous rollback. */
    let terminalHandlersInstalled = false
    /** Caller cancellation wins while preserving its captured original reason. */
    const cancellationFailure = (): StorageContractError =>
      new StorageContractError(StorageContractErrorCode.aborted, {
        backend: StorageBackend.indexedDb,
        cause: abortReason
      })
    const onAbort = (): void => {
      cancelled = true
      abortReason = readAbortReason(signal)
      try {
        transaction.abort()
      } catch {
        // Transaction may already be completed; result still settles through IDB events.
      }
    }
    const finish = (settle: () => void): void => {
      if (settled) return
      settled = true
      disposeAbort()
      settle()
    }
    try {
      installIdbTransactionHandlers(
        transaction,
        () =>
          finish(() => {
            if (cancelled) reject(cancellationFailure())
            else if (firstFailure !== undefined) reject(firstFailure)
            else resolve()
          }),
        (event) => {
          /** Request errors bubble before transaction.error is populated on native abort. */
          const target = event?.target
          const cause =
            target !== undefined && target !== null && target !== transaction
              ? readIdbRequestError(target as IDBRequest)
              : readIdbTransactionError(transaction)
          firstFailure ??= new StorageError(StorageErrorCode.transactionFailed, {
            backend: StorageBackend.indexedDb,
            cause
          })
        },
        () =>
          finish(() =>
            reject(
              cancelled
                ? cancellationFailure()
                : (firstFailure ?? normalizeTransactionAbort(readIdbTransactionError(transaction)))
            )
          )
      )
      terminalHandlersInstalled = true
      disposeAbort = subscribeToAbort(signal, onAbort, runtime.reporter)
    } catch (cause) {
      firstFailure ??= normalizeIdbRequestFailure(cause)
      try {
        transaction.abort()
      } catch {
        /* setup failure already owns the result; transaction may already be settled */
      }
      // A rejected handler setter acquired no usable terminal bridge. Signal setup failures did,
      // so their rollback must still drain through the original native abort/complete handlers.
      if (!terminalHandlersInstalled) finish(() => reject(firstFailure))
    }
  })
}
