import { StoreLightErrorCode, type IStoreLightErrorCode } from './error-code.js';

export { StoreLightErrorCode, type IStoreLightErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_LIGHT_SOURCE = '@migaia/store-light';

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreLightError<E extends Error>(error: E, code: IStoreLightErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_LIGHT_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreLightError(
  code: IStoreLightErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreLightError(error, code);
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreLightRangeError(
  code: IStoreLightErrorCode,
  message: string
): RangeError {
  return tagStoreLightError(new RangeError(message), code);
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStoreLightTypeError(
  code: IStoreLightErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError {
  return tagStoreLightError(
    new TypeError(message, options?.cause !== undefined ? { cause: options.cause } : undefined),
    code
  );
}

/** Builds a `(source, code)`-tagged `AggregateError`; `errors[]` stays reachable (E-T13). */
export function createStoreLightAggregateError(
  code: IStoreLightErrorCode,
  errors: unknown[],
  message: string
): AggregateError {
  return tagStoreLightError(new AggregateError(errors, message), code);
}
