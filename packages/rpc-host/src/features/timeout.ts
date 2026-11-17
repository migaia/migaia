/** Public timeout Feature factory; the execution it installs is host machinery in `feature/`. */
import { defineFeature } from '@migaia/plugin-host/features'
import type { IRpcTimeoutFeature, ITimeoutFeatureOptions } from '@migaia/rpc-contract/interfaces'
import { createRpcTimeoutExecution, snapshotTimeout } from '../feature/timeout-execution.ts'
import { registerRpcFeature, RpcCallFeatureRole } from '../sdk/metadata.ts'
export type { ITimeoutFeatureOptions } from '@migaia/rpc-contract/interfaces'
export { createRpcTimeoutExecution } from '../feature/timeout-execution.ts'

/** Define a cold native timeout; every declaring plugin receives its own installed execution owner. */
export function timeoutFeature(options: ITimeoutFeatureOptions): IRpcTimeoutFeature {
  /** Validate and snapshot the original descriptor before native installation can observe mutation. */
  const policy = snapshotTimeout(options)
  /** Native registration alone invokes the captured construction hook. */
  const feature = defineFeature({ install: () => createRpcTimeoutExecution(policy) })
  registerRpcFeature(feature, { role: RpcCallFeatureRole.timeout })
  return feature
}

export default timeoutFeature
