import { RpcCapability } from '../wire-constants.js'
import { RpcRuntimeCancel, RpcRuntimeMode } from './constants.js'
import type { IRpcRuntimeOptions } from './types.js'

/** Return the exact AND dependencies for an opted-in operation, never an inferred offer closure. */
export function runtimeOperationCapabilities(
  mode: RpcRuntimeMode,
  options: IRpcRuntimeOptions = {},
  hasSignal = false
): readonly string[] {
  /** Only requested semantics enter this set; ordinary calls never invoke this opt-in branch. */
  const required: string[] = [RpcCapability.runtimeApi, RpcCapability.generation]
  if (mode === RpcRuntimeMode.stream) required.push(RpcCapability.stream)
  if (mode === RpcRuntimeMode.group) required.push(RpcCapability.group)
  if (options.orderKey !== undefined) required.push(RpcCapability.order)
  if (options.cancel === RpcRuntimeCancel) required.push(RpcCapability.cancelBeforeStart)
  if (mode === RpcRuntimeMode.outcome || options.idempotencyKey !== undefined)
    required.push(RpcCapability.outcome)
  if (options.cancel !== RpcRuntimeCancel) {
    if (options.timeoutMs !== undefined) required.push(RpcCapability.deadline)
    if (hasSignal) required.push(RpcCapability.abort)
  }
  return Object.freeze(required)
}
