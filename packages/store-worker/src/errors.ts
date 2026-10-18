import { StoreWorkerErrorCode, type IStoreWorkerErrorCode } from './error-code.js'

export { StoreWorkerErrorCode, type IStoreWorkerErrorCode }

/** `source` identity of package-owned errors; foreign RPC/application identities retain their owner. */
export const STORE_WORKER_SOURCE = '@migaia/store-worker'

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreWorkerError<E extends Error>(error: E, code: IStoreWorkerErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_WORKER_SOURCE, code })
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
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

/** Builds a tagged aggregate while preserving cleanup error order and identity. */
export function createStoreWorkerAggregateError(
  code: IStoreWorkerErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreWorkerError(new AggregateError(errors, message), code)
}
import { attachErrorIdentity } from '@migaia/utils/error'
