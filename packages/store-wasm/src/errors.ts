import { StoreWasmErrorCode, type IStoreWasmErrorCode } from './error-code.js';

export { StoreWasmErrorCode, type IStoreWasmErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORE_WASM_SOURCE = '@migaia/store-wasm';

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreWasmError<E extends Error>(error: E, code: IStoreWasmErrorCode): E {
  Object.defineProperty(error, 'source', { value: STORE_WASM_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreWasmError(
  code: IStoreWasmErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagStoreWasmError(error, code);
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreWasmRangeError(code: IStoreWasmErrorCode, message: string): RangeError {
  return tagStoreWasmError(new RangeError(message), code);
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStoreWasmTypeError(code: IStoreWasmErrorCode, message: string): TypeError {
  return tagStoreWasmError(new TypeError(message), code);
}
