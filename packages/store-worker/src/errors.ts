import { ERROR_SOURCE, StoreWorkerErrorCode, type IStoreWorkerErrorCode } from './error-code.js'

export { StoreWorkerErrorCode, type IStoreWorkerErrorCode }

/** `source` identity of package-owned errors; foreign RPC/application identities retain their owner. */
export const STORE_WORKER_SOURCE = ERROR_SOURCE

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreWorkerError<E extends Error>(error: E, code: IStoreWorkerErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_WORKER_SOURCE, code })
}

/**
 * Constructs a tagged native Error for an explicit code/message without rewriting its stack. A
 * defined options.cause retains the original value by identity; this factory creates a new error
 * rather than changing an existing exception. Ordinary callers usually inspect RPC or Resource
 * outcomes instead of constructing local errors.
 */
export function createStoreWorkerError(
  code: IStoreWorkerErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreWorkerError(error, code)
}

/**
 * Constructs a tagged native AggregateError retaining supplied failure order and identities in
 * errors. It neither deduplicates failures nor replaces their original stacks.
 */
export function createStoreWorkerAggregateError(
  code: IStoreWorkerErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreWorkerError(new AggregateError(errors, message), code)
}
import { attachErrorIdentity } from '@migaia/utils/error'
