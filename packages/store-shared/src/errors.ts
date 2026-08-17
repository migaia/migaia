import { StoreSharedErrorCode, type IStoreSharedErrorCode } from './error-code.js';

export { StoreSharedErrorCode, type IStoreSharedErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_SHARED_SOURCE = '@migaia/store-shared';

function tagStoreSharedError<E extends Error>(error: E, code: IStoreSharedErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_SHARED_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreSharedError(
  code: IStoreSharedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreSharedError(error, code);
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreSharedRangeError(
  code: IStoreSharedErrorCode,
  message: string
): RangeError {
  return tagStoreSharedError(new RangeError(message), code);
}
