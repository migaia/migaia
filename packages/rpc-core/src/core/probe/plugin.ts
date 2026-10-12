import { RpcCoreErrorCode } from '../error-code.js'
import { RpcCoreErrorText } from '../error-text.js'
import { tagRpcError } from '../errors.js'
import type { IRpcPlugin } from '../typing.js'
import type { IRpcProbe } from './types.js'

/** Contract-only placeholder; probe-core replaces this body with the actual endpoint installation. */
export function probePlugin(..._probes: readonly IRpcProbe[]): IRpcPlugin {
  throw tagRpcError(
    new TypeError(RpcCoreErrorText.probeRuntimeNotInstalled),
    RpcCoreErrorCode.invalidConfig
  )
}
