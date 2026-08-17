import { LoggerErrorCode, type ILoggerErrorCode } from './error-code.js';

export { LoggerErrorCode, type ILoggerErrorCode };

/** `source` value stamped onto every error this package throws. */
export const LOGGER_SOURCE = '@migaia/logger';

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagLoggerError<E extends Error>(error: E, code: ILoggerErrorCode): E {
  Object.defineProperty(error, 'source', { value: LOGGER_SOURCE, enumerable: true });
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createLoggerError(
  code: ILoggerErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  );
  return tagLoggerError(error, code);
}
