import { RpcDevtoolsErrorCode } from './error-code.js'
import { RpcDevtoolsErrorText } from './error-text.js'
import { identifyDevtoolsError } from './errors.js'
import type { IRpcDevtools, IRpcDevtoolsOptions } from './collector-types.js'

/** Layer-1 placeholder: collector construction becomes available when layer 2 replaces this body. */
export function createRpcDevtools(_options?: IRpcDevtoolsOptions): IRpcDevtools {
  throw identifyDevtoolsError(
    new Error(RpcDevtoolsErrorText.collectorNotInstalled),
    RpcDevtoolsErrorCode.closed
  )
}

export type { IRpcDevtools, IRpcDevtoolsOptions } from './collector-types.js'
export {
  RpcDevtoolsErrorCode,
  ERROR_SOURCE as RPC_DEVTOOLS_SOURCE,
  type IRpcDevtoolsErrorCode
} from './error-code.js'
