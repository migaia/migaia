import { StorePersistErrorCode, type IStorePersistErrorCode } from './error-code.js';

export { StorePersistErrorCode, type IStorePersistErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_PERSIST_SOURCE = '@migaia/store-persist';

function tagStorePersistError<E extends Error>(error: E, code: IStorePersistErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_PERSIST_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStorePersistError(
  code: IStorePersistErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStorePersistError(error, code);
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStorePersistTypeError(
  code: IStorePersistErrorCode,
  message: string
): TypeError {
  return tagStorePersistError(new TypeError(message), code);
}

/** Builds a `(source, code)`-tagged `AggregateError`, preserving `errors[]` as a cause path. */
export function createStorePersistAggregateError(
  code: IStorePersistErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStorePersistError(new AggregateError(errors, message), code);
}
