import { StoreReactErrorCode, type IStoreReactErrorCode } from './error-code.js';

export { StoreReactErrorCode, type IStoreReactErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_REACT_SOURCE = '@migaia/store-react';

function tagStoreReactError<E extends Error>(error: E, code: IStoreReactErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_REACT_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreReactError(
  code: IStoreReactErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreReactError(error, code);
}

/** Builds a `(source, code)`-tagged `AggregateError`, preserving `errors[]` as a cause path. */
export function createStoreReactAggregateError(
  code: IStoreReactErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreReactError(new AggregateError(errors, message), code);
}
