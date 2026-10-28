/**
 * Attaches centralized Pool identities to native errors and preserves the original queued-abort
 * cause. Error text remains owned by the Pool contract.
 */
import {
  RPC_POOL_ERROR_SOURCE,
  RpcPoolErrorCode,
  type IRpcPoolErrorCode
} from '@migaia/rpc-contract/error-code'
import { RpcPoolText } from './text.ts'

/** Attach a registered code without replacing the native error, stack, or original cause. */
export function tagPoolError<T extends Error>(error: T, code: IRpcPoolErrorCode): T {
  Object.defineProperties(error, {
    source: { value: RPC_POOL_ERROR_SOURCE, enumerable: true },
    code: { value: code, enumerable: true }
  })
  return error
}

/** A queued cancellation retains the exact caller reason on its native AbortError. */
export function queuedPoolAbort(reason: unknown): Error {
  /** DOMException has no cause constructor option, so preserve the reason on the existing object. */
  const error = new DOMException(RpcPoolText.aborted, RpcPoolText.abortName)
  Object.defineProperty(error, 'cause', { value: reason })
  return tagPoolError(error, RpcPoolErrorCode.callAborted)
}
