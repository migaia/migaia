import { StoreKeyedErrorCode, type IStoreKeyedErrorCode } from './error-code.js';
import { attachErrorIdentity } from '@migaia/utils/error';

export { StoreKeyedErrorCode, type IStoreKeyedErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_KEYED_SOURCE = '@migaia/store-keyed';

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreKeyedError<E extends Error>(error: E, code: IStoreKeyedErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_KEYED_SOURCE, code });
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
  message: string,
  options?: { readonly cause?: unknown }
): RangeError {
  return tagStoreKeyedError(
    new RangeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code
  );
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStoreKeyedTypeError(
  code: IStoreKeyedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError {
  return tagStoreKeyedError(
    new TypeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code
  );
}

/** Builds a `(source, code)`-tagged `AggregateError`; `errors[]` stays reachable. */
export function createStoreKeyedAggregateError(
  code: IStoreKeyedErrorCode,
  errors: unknown[],
  message: string
): AggregateError {
  return tagStoreKeyedError(new AggregateError(errors, message), code);
}
