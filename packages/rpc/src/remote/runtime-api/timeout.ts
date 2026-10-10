import { RpcCoreErrorCode, RpcError } from '../../core/errors.js'
import { RUNTIME_API_DEFAULT_TIMEOUT_MS, RuntimeApiErrorText } from './constants.js'

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

export { prepareRuntimeCallTimeout } from '../../core/internal/runtime-call-options.js'
