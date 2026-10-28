/** Classifies RPC and native cancellation or deadline failures for collector statistics. */
import {
  RpcCoreErrorCode,
  RPC_ENDPOINT_ERROR_SOURCE as RPC_CORE_ERROR_SOURCE
} from '@migaia/rpc-contract/error-code'
import { CollectorText } from './text.ts'

/** Statistics and logging share one classification of the frozen failed observation outcome. */
export const RpcDevtoolsFailure = {
  /** A generic failure has no supported deadline or cancellation identity. */
  failed: 0,
  /** Core deadline identity takes precedence over the retained native error name. */
  timeout: 1,
  /** Core cancellation identity takes precedence over the retained native error name. */
  aborted: 2
} as const

/** Stable domain names share the runtime classification owner's namespace. */
export type RpcDevtoolsFailure = keyof typeof RpcDevtoolsFailure

/** Read Core source/code first, then platform-native names; callers own getter-failure reporting. */
export function classifyRpcFailure(error: unknown): number {
  if (typeof error !== 'object' || error === null) return RpcDevtoolsFailure.failed
  /** Only Core-owned codes carry canonical RPC cancellation and deadline meaning. */
  const identity = error as { source?: unknown; code?: unknown; name?: unknown }
  if (identity.source === RPC_CORE_ERROR_SOURCE) {
    if (identity.code === RpcCoreErrorCode.deadlineExceeded) return RpcDevtoolsFailure.timeout
    if (identity.code === RpcCoreErrorCode.cancelled) return RpcDevtoolsFailure.aborted
  }
  if (identity.name === CollectorText.timeoutName) return RpcDevtoolsFailure.timeout
  if (identity.name === CollectorText.abortName) return RpcDevtoolsFailure.aborted
  return RpcDevtoolsFailure.failed
}
