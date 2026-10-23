import {
  checkRuntimeDescription,
  type IRuntimePeerDescription
} from '../runtime-api/description.js'
import { RuntimeApiMode } from '../runtime-api/directory-constants.js'
import { RpcShapeReason, type IRpcShapeCheck } from '../remote/check-result.js'

/**
 * Check the original runtime directory first, then reject only the bridge's unsupported stream
 * mode.
 */
export function checkJsonRpcDescription(input: unknown): IRpcShapeCheck<IRuntimePeerDescription> {
  const result = checkRuntimeDescription(input)
  if (!result.ok) return result
  return result.value.methods.some((method) =>
    method.supportedModes.includes(RuntimeApiMode.stream)
  )
    ? Object.freeze({ ok: false, reason: RpcShapeReason['jsonrpc-stream'], path: '$.methods' })
    : result
}
