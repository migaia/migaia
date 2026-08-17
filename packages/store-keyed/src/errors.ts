import { StoreKeyedErrorCode, type IStoreKeyedErrorCode } from './error-code.js';

export { StoreKeyedErrorCode, type IStoreKeyedErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_KEYED_SOURCE = '@migaia/store-keyed';

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreKeyedError<E extends Error>(error: E, code: IStoreKeyedErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_KEYED_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreKeyedError(
  code: IStoreKeyedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreKeyedError(error, code);
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreKeyedRangeError(
  code: IStoreKeyedErrorCode,
  message: string
): RangeError {
  return tagStoreKeyedError(new RangeError(message), code);
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStoreKeyedTypeError(code: IStoreKeyedErrorCode, message: string): TypeError {
  return tagStoreKeyedError(new TypeError(message), code);
}

/** Builds a `(source, code)`-tagged `AggregateError`; `errors[]` stays reachable. */
export function createStoreKeyedAggregateError(
  code: IStoreKeyedErrorCode,
  errors: unknown[],
  message: string
): AggregateError {
  return tagStoreKeyedError(new AggregateError(errors, message), code);
}
