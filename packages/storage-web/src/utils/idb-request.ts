import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { isStorageErrorFamily } from '../core/error-family.js'
import type { IStorageOperationRuntime } from '../core/operation-reporter.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { normalizeStorageException } from './quota.js'
import {
  readAbortReason,
  snapshotOperationContext,
  subscribeToAbort,
  type IWebAbortSignal
} from '../core/operation.js'
import { StorageBackend } from '../constants.js'

/**
 * IndexedDB 请求/事务 → Promise 的转换。这两个函数是从早期实现直接搬运的 已验证坑位处理，逐条保留： - 写入必须等 `transaction.oncomplete` 而非
 * `request.onsuccess`——后者只 代表「请求被接受」，事务仍可能因配额超限、commit 失败或被 abort 而整体回滚。 - `AbortSignal` 是协作式的：单次
 * IDBRequest 撤不回来，只能丢弃结果。
 */
/**
 * Carries the runtime-neutral cancellation surface through IndexedDB helpers. The helpers only
 * subscribe/read cancellation state; they do not require DOM-only AbortSignal members, so retaining
 * the contract type keeps storage-web usable in non-DOM test consumers.
 */
export type IIdbOperationContext = { readonly signal?: IWebAbortSignal }

const normalizeTransactionAbort = (error: unknown): StorageError | StorageContractError => {
  const normalized = normalizeStorageException(error, StorageBackend.indexedDb)
  if (normalized.code === StorageErrorCode.quotaExceeded) return normalized
  return new StorageError(StorageErrorCode.transactionFailed, {
    backend: StorageBackend.indexedDb,
    cause: error
  })
}

export const normalizeIdbRequestFailure = (error: unknown): StorageError | StorageContractError => {
  if (isStorageErrorFamily(error)) return error
  const normalized = normalizeStorageException(error, StorageBackend.indexedDb)
  return normalized.code === StorageErrorCode.quotaExceeded
    ? normalized
    : new StorageError(StorageErrorCode.transactionFailed, {
        backend: StorageBackend.indexedDb,
        cause: error
      })
}

/** Read a host transaction error without letting a getter escape its event callback. */
export const readIdbTransactionError = (transaction: IDBTransaction): unknown => {
  try {
    return transaction.error
  } catch (cause) {
    return cause
  }
}

/** Read a host request result and normalize getter failures at the canonical bridge boundary. */
export const readIdbRequestResult = <T>(request: IDBRequest<T>): T => {
  try {
    return request.result
  } catch (cause) {
    throw normalizeIdbRequestFailure(cause)
  }
}

/** Read a host request error without allowing its getter to escape a DOM event callback. */
export const readIdbRequestError = (request: IDBRequest): unknown => {
  try {
    return request.error
  } catch (cause) {
    return cause
  }
}

/** Read the versionchange transaction without allowing a host getter to escape upgrade handling. */
export const readIdbOpenTransaction = (request: IDBOpenDBRequest): IDBTransaction | null => {
  try {
    return request.transaction
  } catch (cause) {
    throw normalizeIdbRequestFailure(cause)
  }
}

/** Install the two request handlers as one normalized host setup boundary. */
export const installIdbRequestHandlers = (
  request: IDBRequest,
  onSuccess: () => void,
  onError: () => void
): void => {
  try {
    request.onsuccess = onSuccess
    request.onerror = onError
  } catch (cause) {
    throw normalizeIdbRequestFailure(cause)
  }
}

/** Install all transaction terminal handlers as one normalized host setup boundary. */
export const installIdbTransactionHandlers = (
  transaction: IDBTransaction,
  onComplete: () => void,
  onError: () => void,
  onAbort: () => void
): void => {
  try {
    transaction.oncomplete = onComplete
    transaction.onerror = onError
    transaction.onabort = onAbort
  } catch (cause) {
    throw normalizeIdbRequestFailure(cause)
  }
}

/** Install the complete open-request lifecycle as one normalized host setup boundary. */
export const installIdbOpenRequestHandlers = (
  request: IDBOpenDBRequest,
  onUpgradeNeeded: () => void,
  onBlocked: () => void,
  onSuccess: () => void,
  onError: () => void
): void => {
  try {
    request.onupgradeneeded = onUpgradeNeeded
    request.onblocked = onBlocked
    request.onsuccess = onSuccess
    request.onerror = onError
  } catch (cause) {
    throw normalizeIdbRequestFailure(cause)
  }
}

/** 把一次 IDBRequest 包成 Promise，并接上取消信号。 */
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

/** 等到事务真正 commit 才算写成功；`request.onsuccess` 只保证请求被接受，不保证落盘。 */
export function idbTransactionCommit(
  transaction: IDBTransaction,
  context: IIdbOperationContext | undefined,
  runtime: IStorageOperationRuntime
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const signal = snapshotOperationContext(context)?.signal
    /** Records caller cancellation independently from later transaction abort events. */
    let cancelled = false
    /** Snapshots cancellation cause before a hostile reason getter can drift. */
    let abortReason: unknown
    /** Owns the active abort listener and remains a no-op before subscription returns. */
    let disposeAbort = (): void => {}
    /** Prevents hostile or duplicated transaction events from changing bridge ownership twice. */
    let settled = false
    const onAbort = (): void => {
      cancelled = true
      abortReason = readAbortReason(signal)
      try {
        transaction.abort()
      } catch {
        // Transaction may already be completed; result still settles through IDB events.
      }
      finish(() =>
        reject(
          new StorageContractError(StorageContractErrorCode.aborted, {
            backend: StorageBackend.indexedDb,
            cause: abortReason
          })
        )
      )
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
        () => finish(resolve),
        () =>
          finish(() =>
            reject(
              new StorageError(StorageErrorCode.transactionFailed, {
                backend: StorageBackend.indexedDb,
                cause: readIdbTransactionError(transaction)
              })
            )
          ),
        () =>
          finish(() =>
            reject(
              cancelled
                ? new StorageContractError(StorageContractErrorCode.aborted, {
                    backend: StorageBackend.indexedDb,
                    cause: abortReason
                  })
                : normalizeTransactionAbort(readIdbTransactionError(transaction))
            )
          )
      )
      disposeAbort = subscribeToAbort(signal, onAbort, runtime.reporter)
    } catch (cause) {
      finish(() => reject(normalizeIdbRequestFailure(cause)))
      try {
        transaction.abort()
      } catch {
        /* setup failure already owns the result; transaction may already be settled */
      }
    }
  })
}
