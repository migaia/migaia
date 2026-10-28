import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, type ILogProcessErrorCode } from './error-code.ts'
import { LogProcessErrorText } from './error-text.ts'

/** Frozen native errors retain their runtime prototype, stack and nested error-array identity. */
export function tagProcessError<E extends Error>(error: E, code: ILogProcessErrorCode): E {
  try {
    return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
  } catch {
    /** The original remains reachable even when its metadata fields cannot be attached. */
    const wrapper = new Error(LogProcessErrorText.taggingFailed, { cause: error })
    try {
      Object.setPrototypeOf(wrapper, Object.getPrototypeOf(error))
    } catch {
      /* The native Error fallback still retains the original cause. */
    }
    try {
      Object.defineProperty(wrapper, 'name', {
        value: error.name,
        configurable: true,
        writable: true
      })
    } catch {
      /* An unreadable name cannot sever the original cause. */
    }
    if (error instanceof AggregateError) {
      try {
        Object.defineProperty(wrapper, 'errors', { value: error.errors, configurable: true })
      } catch {
        /* Aggregate branches remain reachable through the original cause. */
      }
    }
    Object.defineProperty(wrapper, 'source', { value: ERROR_SOURCE, enumerable: true })
    Object.defineProperty(wrapper, 'code', { value: code, enumerable: true })
    return wrapper as E
  }
}

/** Construct only an owner-coded native wrapper; never rewrite the original failure's stack. */
export function processError(code: ILogProcessErrorCode, text: string, cause?: unknown): Error {
  return tagProcessError(new Error(text, cause === undefined ? undefined : { cause }), code)
}

/** Cleanup keeps primary-first order and protects nested aggregates from lifecycle flattening. */
export function processCleanupError(
  code: ILogProcessErrorCode,
  text: string,
  errors: readonly unknown[]
): Error {
  /**
   * A single original stays directly on cause; multiple failures remain ordered under one
   * aggregate.
   */
  const cause = errors.length === 1 ? errors[0] : new AggregateError(errors, text)
  return processError(code, text, cause)
}
