import { ERROR_SOURCE, type IRpcDevtoolsErrorCode } from './error-code.js'

/** Attach devtools identity to the native error without replacing its type, stack or cause. */
export function identifyDevtoolsError<T extends Error>(error: T, code: IRpcDevtoolsErrorCode): T {
  Object.defineProperty(error, 'source', { value: ERROR_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}
