/**
 * Builds ordered native-member cleanup aggregates with the existing remote-layer error identity.
 * Original failures remain reachable without allocating member state, supervision policy or another
 * error registry.
 */
import { attachErrorIdentity } from '@migaia/utils/error'
import { RPC_REMOTE_ERROR_SOURCE, RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'

/** Original ordered native preparation/cleanup errors remain reachable without changing classes. */
export function memberAggregate(
  errors: readonly unknown[],
  code: typeof RpcRemoteLayerErrorCode.startFailed | typeof RpcRemoteLayerErrorCode.closed
): AggregateError {
  /** The legacy aggregate had no separate display message; native child identities are unchanged. */
  const error = new AggregateError(errors)
  return attachErrorIdentity(error, { source: RPC_REMOTE_ERROR_SOURCE, code })
}
