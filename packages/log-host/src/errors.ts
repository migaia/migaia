import { attachErrorIdentity } from '@migaia/utils/error'
import { ERROR_SOURCE, LogHostErrorCode, type ILogHostErrorCode } from './error-code.ts'
import { LogHostErrorText } from './error-text.ts'
/** Tag an existing native failure, retaining frozen error prototypes, stacks and aggregate order. */
export function tagLogError<E extends Error>(error: E, code: ILogHostErrorCode): E {
  try {
    return attachErrorIdentity(error, { source: ERROR_SOURCE, code })
  } catch {
    /** The new stack belongs to the wrapper; the original stack remains reachable through cause. */
    const wrapper = new Error(LogHostErrorText.errorTaggingFailed, { cause: error })
    try {
      Object.setPrototypeOf(wrapper, Object.getPrototypeOf(error))
    } catch {
      /* The original hostile prototype stays reachable on cause. */
    }
    try {
      Object.defineProperty(wrapper, 'name', {
        value: error.name,
        configurable: true,
        writable: true
      })
    } catch {
      /* The original unreadable name stays reachable on cause. */
    }
    if (error instanceof AggregateError) {
      try {
        Object.defineProperty(wrapper, 'errors', { value: error.errors, configurable: true })
      } catch {
        /* Original aggregate entries stay reachable on cause. */
      }
    }
    Object.defineProperty(wrapper, 'source', { value: ERROR_SOURCE, enumerable: true })
    Object.defineProperty(wrapper, 'code', { value: code, enumerable: true })
    return wrapper as E
  }
}
/**
 * Preserve ordered cleanup failures beneath one boundary error without exposing a flattened
 * aggregate.
 */
export function createLogCleanupError(errors: readonly unknown[]): Error {
  /** A single original remains direct cause; several originals retain their existing order. */
  const cause =
    errors.length === 1
      ? errors[0]
      : new AggregateError(errors, LogHostErrorText.pluginUninstallCleanupFailed)
  return createLogError(
    LogHostErrorCode.pluginUninstallCleanupFailed,
    LogHostErrorText.pluginUninstallCleanupFailed,
    { cause }
  )
}
/** Preserve the native runtime type and optional cause while attaching the host semantic identity. */
export function createLogError(
  code: ILogHostErrorCode,
  text: string,
  options?: ErrorOptions
): Error {
  return attachErrorIdentity(new Error(text, options), { source: ERROR_SOURCE, code })
}
/** Configuration failures keep their native TypeError identity for caller branching. */
export function invalidOption(cause?: unknown): TypeError {
  return attachErrorIdentity(
    new TypeError(LogHostErrorText.invalidOption, cause === undefined ? undefined : { cause }),
    { source: ERROR_SOURCE, code: LogHostErrorCode.invalidOption }
  )
}
/** Admission diagnostics retain native TypeError and the exact original cause when one exists. */
export function createLogTypeError(
  code: ILogHostErrorCode,
  text: string,
  options?: ErrorOptions
): TypeError {
  return attachErrorIdentity(new TypeError(text, options), { source: ERROR_SOURCE, code })
}
