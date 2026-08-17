import { StoreMiddlewareErrorCode, type IStoreMiddlewareErrorCode } from './error-code.js';

export { StoreMiddlewareErrorCode, type IStoreMiddlewareErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_MIDDLEWARE_SOURCE = '@migaia/store-middleware';

function tagStoreMiddlewareError<E extends Error>(error: E, code: IStoreMiddlewareErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_MIDDLEWARE_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
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
