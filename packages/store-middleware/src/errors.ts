import { StoreMiddlewareErrorCode, type IStoreMiddlewareErrorCode } from './error-code.js';
import { attachErrorIdentity } from '@migaia/utils/error';

export { StoreMiddlewareErrorCode, type IStoreMiddlewareErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_MIDDLEWARE_SOURCE = '@migaia/store-middleware';

function tagStoreMiddlewareError<E extends Error>(error: E, code: IStoreMiddlewareErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_MIDDLEWARE_SOURCE, code });
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreMiddlewareError(
  code: IStoreMiddlewareErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreMiddlewareError(error, code);
}

/** Builds a tagged AggregateError while retaining every cleanup failure. */
export function createStoreMiddlewareAggregateError(
  code: IStoreMiddlewareErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreMiddlewareError(new AggregateError(errors, message), code);
}
