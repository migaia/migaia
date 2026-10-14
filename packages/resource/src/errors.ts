/** `source` value stamped onto every error this package throws. */
export const RESOURCE_SOURCE = '@migaia/resource'

/**
 * Defines the workspace structural error contract (`docs/contracts/error-codes.md` §2). `source`
 * and `code` attach as properties without replacing the error. Callers retain native type checks
 * such as `instanceof DOMException` and `instanceof RangeError`.
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
  return attachErrorIdentity(error as Error, { source: RESOURCE_SOURCE, code }) as E
}
import { attachErrorIdentity } from '@migaia/utils/error'
