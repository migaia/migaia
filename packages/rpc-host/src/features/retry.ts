/** Public retry Feature factory; the execution it installs is host machinery in `feature/`. */
import { defineFeature } from '@migaia/plugin-host/features'
import type { IRpcRetryFeature, IRetryFeatureOptions } from '@migaia/rpc-contract/interfaces'
import { createRpcRetryExecution, snapshotRetry } from '../feature/retry-execution.ts'
import { registerRpcFeature, RpcCallFeatureRole } from '../sdk/metadata.ts'
export type { IRetryFeatureOptions } from '@migaia/rpc-contract/interfaces'
export { createRpcRetryExecution } from '../feature/retry-execution.ts'

/** Define a cold origin strategy whose execution owner belongs to the declaring registration. */
export function retryFeature(options: IRetryFeatureOptions = {}): IRpcRetryFeature {
  /** Snapshot and validate now, without creating any logical invocation or native resource. */
  const policy = snapshotRetry(options)
  /** Installation creates the actual independent owner; the token exposes no execution methods. */
  const feature = defineFeature({ install: () => createRpcRetryExecution(policy) })
  registerRpcFeature(feature, { role: RpcCallFeatureRole.retry })
  return feature
}

export default retryFeature
