import { StoreWorkerErrorCode, type IStoreWorkerErrorCode } from './error-code.js';

export { StoreWorkerErrorCode, type IStoreWorkerErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_WORKER_SOURCE = '@migaia/store-worker';

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreWorkerError<E extends Error>(error: E, code: IStoreWorkerErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_WORKER_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
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
  );
  return tagStoreWorkerError(error, code);
}
