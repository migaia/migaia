import { StoreDevtoolsErrorCode, type IStoreDevtoolsErrorCode } from './error-code.js';

export { StoreDevtoolsErrorCode, type IStoreDevtoolsErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_DEVTOOLS_SOURCE = '@migaia/store-devtools';

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreDevtoolsError<E extends Error>(error: E, code: IStoreDevtoolsErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_DEVTOOLS_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreDevtoolsError(
  code: IStoreDevtoolsErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreDevtoolsError(error, code);
}

/**
 * Builds a `(source, code)`-tagged `RangeError`. The error type matters to callers that branch on
 * `instanceof RangeError`, so this preserves it instead of producing a plain `Error`.
 */
export function createStoreDevtoolsRangeError(
  code: IStoreDevtoolsErrorCode,
  message: string
): RangeError {
  return tagStoreDevtoolsError(new RangeError(message), code);
}
