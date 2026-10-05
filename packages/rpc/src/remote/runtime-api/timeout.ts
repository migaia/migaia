import { RpcCoreErrorCode, RpcError } from '../../core/errors.js'
import {
  isForwardedOperation,
  retainForwardOptions
} from '../../core/internal/outbound-envelope.js'
import { RUNTIME_API_DEFAULT_TIMEOUT_MS, RuntimeApiErrorText } from './constants.js'
import type { IRuntimeCallOptions } from './typing.js'

/** Validate the simple factory's default before any original native/source owner is acquired. */
export function readRuntimeDefaultTimeout(
  options: Readonly<{ defaultTimeoutMs?: number }>
): number {
  /** One cold read separates factory positive defaults from the core per-call false/zero domain. */
  const value = options.defaultTimeoutMs
  if (value === undefined) return RUNTIME_API_DEFAULT_TIMEOUT_MS
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.defaultTimeoutInvalid)
  return value
}

/** Reuse one default input and retain private forwarding proof when optional fields need a copy. */
export function prepareRuntimeCallTimeout(
  timeoutMs: number
): (options?: IRuntimeCallOptions) => IRuntimeCallOptions {
  /** Ordinary calls with no options borrow this immutable input rather than allocate per request. */
  const defaults = Object.freeze({ timeoutMs })
  return (options) =>
    options?.timeoutMs !== undefined
      ? options
      : options === undefined
        ? defaults
        : retainForwardOptions(options, {
            ...options,
            /** An admitted upstream call already owns its budget, including an absent deadline. */
            timeoutMs: isForwardedOperation(options) ? false : timeoutMs
          })
}
