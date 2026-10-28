/** Canonical Resource error identity attachment and foreign-failure preservation. */
import { ERROR_SOURCE } from './error-code.ts'
/**
 * Source stamped onto Resource-owned failures; classified foreign errors retain their original
 * owner.
 */
export const RESOURCE_SOURCE = ERROR_SOURCE

/**
 * Defines the workspace structural error contract. `source` and `code` attach as properties without
 * replacing the error. Callers retain native type checks such as `instanceof DOMException` and
 * `instanceof RangeError`.
 */
export type IResourceError = Error & {
  readonly source: string
  readonly code: string
}

/**
 * Creates an `Error` carrying `(source, code)` without rewriting `stack`. The engine fills the
 * stack at construction, and this function preserves it.
 */
export function createResourceError(
  code: string,
  message: string,
  options?: { readonly cause?: unknown }
): IResourceError {
  /** Boundary wrapper retains its native stack and caller-supplied cause. */
  const error = new Error(message, options)
  return attachErrorIdentity(error, { source: RESOURCE_SOURCE, code }) as IResourceError
}

/**
 * Attaches `(source, code)` to an existing error such as `DOMException` or `RangeError`. Preserves
 * `message`, `name`, and other constructor-owned fields. Use it when callers rely on the native
 * type instead of the plain `Error` from `createResourceError`. `REQUEST_ABORTED` and
 * `REQUEST_CANCELLED` retain `DOMException` with `name === 'AbortError'`. The generic permits
 * attaching identity to native error objects without requiring callers to narrow them to `Error`.
 * Both support attached readonly properties at runtime.
 */
export function tagResourceError<E extends object>(error: E, code: string): E {
  /** Some DOMException hosts omit stacks; preserve every existing nonempty native stack. */
  const native = error as Error
  if (typeof native.stack !== 'string' || native.stack.length === 0) {
    Object.defineProperty(error, 'stack', {
      value: new Error(native.message).stack,
      configurable: true,
      writable: true
    })
  }
  return attachErrorIdentity(error as Error, { source: RESOURCE_SOURCE, code }) as E
}
import {
  attachErrorIdentity,
  attachSecondaryErrors,
  isNativeErrorValue,
  tryReadProperty
} from '@migaia/utils/error'

/**
 * Gives unclassified callback failures a boundary identity while retaining existing owners and
 * native types.
 */
export function identifyResourceFailure(error: unknown, code: string, message: string): unknown {
  if (isNativeErrorValue(error)) {
    /** A complete foreign semantic identity stays owned by its originating package. */
    const source = tryReadProperty(error as Error & { source?: unknown }, 'source')
    /** Existing code is sampled independently so hostile accessors remain contained. */
    const existingCode = tryReadProperty(error as Error & { code?: unknown }, 'code')
    if (
      !source.threw &&
      !existingCode.threw &&
      typeof source.value === 'string' &&
      source.value.length > 0 &&
      typeof existingCode.value === 'string' &&
      existingCode.value.length > 0
    )
      return error
    try {
      return tagResourceError(error, code)
    } catch (attachmentError) {
      return attachSecondaryErrors(createResourceError(code, message, { cause: error }), [
        attachmentError
      ])
    }
  }
  return createResourceError(code, message, { cause: error })
}
