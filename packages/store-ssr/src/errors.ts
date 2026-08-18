import { StoreSsrErrorCode, type IStoreSsrErrorCode } from './error-code.js';
import { attachErrorIdentity } from '@migaia/utils/error';

export { StoreSsrErrorCode, type IStoreSsrErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_SSR_SOURCE = '@migaia/store-ssr';

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
const tagStoreSsrError = <E extends Error>(error: E, code: IStoreSsrErrorCode): E =>
  attachErrorIdentity(error, { source: STORE_SSR_SOURCE, code });

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreSsrError(
  code: IStoreSsrErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreSsrError(error, code);
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreSsrRangeError(code: IStoreSsrErrorCode, message: string): RangeError {
  return tagStoreSsrError(new RangeError(message), code);
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStoreSsrTypeError(code: IStoreSsrErrorCode, message: string): TypeError {
  return tagStoreSsrError(new TypeError(message), code);
}

/** Builds a `(source, code)`-tagged `AggregateError`; `errors[]` stays reachable. */
export function createStoreSsrAggregateError(
  code: IStoreSsrErrorCode,
  errors: unknown[],
  message: string
): AggregateError {
  return tagStoreSsrError(new AggregateError(errors, message), code);
}
