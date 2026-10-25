/**
 * Attaches centralized Devtools identities to existing native errors without replacing their
 * stacks.
 */
import {
  RPC_DEVTOOLS_ERROR_SOURCE as ERROR_SOURCE,
  type IRpcDevtoolsErrorCode
} from '@migaia/rpc-contract/error-code'

/** Attach devtools identity to the native error without replacing its type, stack or cause. */
export function identifyDevtoolsError<T extends Error>(error: T, code: IRpcDevtoolsErrorCode): T {
  Object.defineProperty(error, 'source', { value: ERROR_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}
