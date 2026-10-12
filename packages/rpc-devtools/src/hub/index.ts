import { RpcDevtoolsErrorCode } from '../error-code.js'
import { RpcDevtoolsErrorText } from '../error-text.js'
import { identifyDevtoolsError } from '../errors.js'
import type { IRpcDevtoolsHub, IRpcDevtoolsHubOptions } from './types.js'

/** Layer-1 placeholder: target aggregation becomes available when layer 2 replaces this body. */
export function createRpcDevtoolsHub(_options?: IRpcDevtoolsHubOptions): IRpcDevtoolsHub {
  throw identifyDevtoolsError(
    new Error(RpcDevtoolsErrorText.hubNotInstalled),
    RpcDevtoolsErrorCode.closed
  )
}

export * from './types.js'
