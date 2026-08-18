import { StoreIndexedErrorCode, type IStoreIndexedErrorCode } from './error-code.js';

export { StoreIndexedErrorCode, type IStoreIndexedErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_INDEXED_SOURCE = '@migaia/store-indexed';

function tagStoreIndexedError<E extends Error>(error: E, code: IStoreIndexedErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_INDEXED_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreIndexedError(
  code: IStoreIndexedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreIndexedError(error, code);
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreIndexedRangeError(
  code: IStoreIndexedErrorCode,
  message: string
): RangeError {
  return tagStoreIndexedError(new RangeError(message), code);
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStoreIndexedTypeError(
  code: IStoreIndexedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError {
  const error = new TypeError(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreIndexedError(error, code);
}
