import { LoggerErrorCode, type ILoggerErrorCode } from './error-code.js'
import { LoggerErrorText } from './error-text.js'
import { attachErrorIdentity } from '@migaia/utils/error'

export { LoggerErrorCode, type ILoggerErrorCode }

/** `source` value stamped onto every error this package throws. */
export const LOGGER_SOURCE = '@migaia/logger'

/** Attaches logger metadata, or returns an attachable wrapper that keeps the original as `cause`. */
export function tagLoggerError<E extends Error>(error: E, code: ILoggerErrorCode): E {
  try {
    return attachErrorIdentity(error, { source: LOGGER_SOURCE, code })
  } catch {
    /** Wrapper carries logger metadata when the original Error is sealed or frozen. */
    const wrapper = new Error(LoggerErrorText.errorTaggingFailed, { cause: error })
    try {
      Object.setPrototypeOf(wrapper, Object.getPrototypeOf(error))
    } catch {
      // The wrapper remains a native Error if a hostile prototype prevents preservation.
    }
    try {
      Object.defineProperty(wrapper, 'name', {
        value: error.name,
        configurable: true,
        enumerable: false,
        writable: true
      })
    } catch {
      // The wrapper's native name is sufficient when the original name is unreadable.
    }
    if (error instanceof AggregateError) {
      try {
        Object.defineProperty(wrapper, 'errors', {
          value: error.errors,
          configurable: true,
          enumerable: false,
          writable: false
        })
      } catch {
        // The original AggregateError and its errors remain reachable through `cause`.
      }
    }
    Object.defineProperty(wrapper, 'source', { value: LOGGER_SOURCE, enumerable: true })
    Object.defineProperty(wrapper, 'code', { value: code, enumerable: true })
    return wrapper as E
  }
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
  )
  return tagLoggerError(error, code)
}

/**
 * Finalizes an HTTP transport failure at the logger boundary. Existing logger delivery errors are
 * returned unchanged so their native type, stack, and identity survive; other thrown values are
 * wrapped with `cause` and the logger-owned `DELIVERY_FAILED` code.
 */
export function ensureLoggerDeliveryError(error: unknown): Error {
  if (
    error instanceof Error &&
    Object.getOwnPropertyDescriptor(error, 'source')?.value === LOGGER_SOURCE &&
    Object.getOwnPropertyDescriptor(error, 'code')?.value === LoggerErrorCode.deliveryFailed
  )
    return error
  return createLoggerError(LoggerErrorCode.deliveryFailed, LoggerErrorText.httpTransportFailed, {
    cause: error
  })
}

/** Builds a tagged native `TypeError` while preserving an admission failure as `cause`. */
export function createLoggerTypeError(
  code: ILoggerErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError {
  const error = new TypeError(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagLoggerError(error, code)
}

/** Builds a tagged AggregateError while preserving primary and rollback error identity. */
export function createLoggerAggregateError(
  code: ILoggerErrorCode,
  message: string,
  errors: readonly unknown[]
): AggregateError {
  return tagLoggerError(new AggregateError(errors, message), code)
}

/**
 * Builds a tagged cleanup error whose nested aggregate survives lifecycle collectors that flatten
 * top-level `AggregateError` values; the primary remains first and every cleanup error stays
 * reachable through `cause` and `AggregateError.errors`.
 */
export function createLoggerCleanupError(
  code: ILoggerErrorCode,
  message: string,
  errors: readonly unknown[]
): Error {
  const cause = errors.length === 1 ? errors[0] : new AggregateError(errors, message)
  return createLoggerError(code, message, { cause })
}
