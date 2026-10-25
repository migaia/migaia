import type { IAbortSignal } from '@migaia/utils/promise'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { isStorageErrorFamily, type IStorageErrorFamily } from '../backends/errors.js'
import type { IStorageOperationRuntime } from '@migaia/storage-host/authoring/backend'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { normalizeStorageException } from './quota.js'
import { readAbortReason } from '@migaia/storage-host/authoring/backend'
import { assertOperationContext } from '@migaia/storage-contract'
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
    assertOperationContext(context)
    /** The supported signal is borrowed immediately; no operation context survives this setup. */
    const signal = context?.signal
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

/** One native commit bridge owns only terminal selection and its original abort listener. */
type IIdbCommitState = {
  /** The native transaction is the sole physical commit or rollback owner. */
  readonly transaction: IDBTransaction
  /** Cancellation borrows the original supported signal without copying its native state. */
  readonly signal: IAbortSignal | undefined
  /** Cleanup diagnostics use the existing per-operation reporter. */
  readonly runtime: IStorageOperationRuntime
  /** Native completion settles this one original bridge promise. */
  readonly resolve: () => void
  /** Native failure and cancellation reject this same original bridge promise. */
  readonly reject: (error: unknown) => void
  /** Caller cancellation is distinct from subsequent native transaction abort events. */
  cancelled: boolean
  /** The first selected caller cancellation reason stays reachable as the storage cause. */
  abortReason: unknown
  /** The original abort subscription detaches at native terminal selection. */
  disposeAbort: () => void
  /** Complete and abort events select only one result. */
  settled: boolean
  /** A bubbled request failure remains primary until actual native termination. */
  firstFailure: IStorageErrorFamily | undefined
}

/**
 * Wait for actual transaction commit. A successful request only confirms acceptance; the native
 * transaction remains the sole owner of persistence, quota failure and rollback.
 */
export function idbTransactionCommit(
  transaction: IDBTransaction,
  context: IIdbOperationContext | undefined,
  runtime: IStorageOperationRuntime
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    assertOperationContext(context)
    /** Terminal state belongs to this one original native transaction and its caller signal. */
    const commitState: IIdbCommitState = {
      transaction,
      signal: context?.signal,
      runtime,
      resolve,
      reject,
      cancelled: false,
      abortReason: undefined,
      disposeAbort: () => {},
      settled: false,
      firstFailure: undefined
    }
    installIdbCommitHandlers(commitState)
    try {
      commitState.disposeAbort = subscribeToAbort(
        commitState.signal,
        () => cancelIdbCommit(commitState),
        runtime.reporter
      )
    } catch (cause) {
      commitState.firstFailure ??= normalizeIdbRequestFailure(cause)
      try {
        transaction.abort()
      } catch {
        /* The existing terminal handlers still settle an already-ended transaction. */
      }
    }
  })
}

/** Native property handlers retain the actual complete/error/abort event order. */
function installIdbCommitHandlers(commitState: IIdbCommitState): void {
  installIdbTransactionHandlers(
    commitState.transaction,
    () =>
      finishIdbCommit(
        commitState,
        commitState.cancelled ? cancellationFailure(commitState) : commitState.firstFailure
      ),
    (event) => observeIdbCommitFailure(commitState, event),
    () =>
      finishIdbCommit(
        commitState,
        commitState.cancelled
          ? cancellationFailure(commitState)
          : (commitState.firstFailure ??
              normalizeTransactionAbort(readIdbTransactionError(commitState.transaction)))
      )
  )
}

/** Cancellation chooses the original caller reason before requesting native rollback. */
function cancelIdbCommit(commitState: IIdbCommitState): void {
  commitState.cancelled = true
  commitState.abortReason = readAbortReason(commitState.signal)
  try {
    commitState.transaction.abort()
  } catch {
    /* Native completion/abort still selects the actual physical terminal. */
  }
}

/** Request errors can bubble before transaction.error receives its native abort diagnostic. */
function observeIdbCommitFailure(commitState: IIdbCommitState, event: Event | undefined): void {
  /** The original event target distinguishes a request error from transaction-level failure. */
  const target = event?.target
  /** Preserve that native error as the cause until physical completion. */
  const cause =
    target !== undefined && target !== null && target !== commitState.transaction
      ? readIdbRequestError(target as IDBRequest)
      : readIdbTransactionError(commitState.transaction)
  commitState.firstFailure ??= new StorageError(StorageErrorCode.transactionFailed, {
    backend: StorageBackend.indexedDb,
    cause
  })
}

/** The caller's cancellation reason retains the existing coded storage boundary. */
function cancellationFailure(commitState: IIdbCommitState): StorageContractError {
  return new StorageContractError(StorageContractErrorCode.aborted, {
    backend: StorageBackend.indexedDb,
    cause: commitState.abortReason
  })
}

/** Select the original terminal once, removing the abort listener before settling its promise. */
function finishIdbCommit(
  commitState: IIdbCommitState,
  failure: IStorageErrorFamily | undefined
): void {
  if (commitState.settled) return
  commitState.settled = true
  commitState.disposeAbort()
  if (failure === undefined) commitState.resolve()
  else commitState.reject(failure)
}
