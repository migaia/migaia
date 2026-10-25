/** Session lends secrets only to the auth resolver; ordinary pipeline contexts carry no values. */
import type { IRpcFlowContext } from '@migaia/rpc-contract/interfaces'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'

/** The physical Session clears its original cell when its lifetime ends. */
export type ISessionCredentials = { value: IRpcPortableValue | undefined }

/** Weak context keys grant no public metadata and cannot retain a completed handshake context. */
const credentials = new WeakMap<IRpcFlowContext, ISessionCredentials>()

/** Associate this exact handshake context with its Session's original clearable secret cell. */
export function bindSessionCredentials(
  context: IRpcFlowContext,
  connection: ISessionCredentials
): IRpcFlowContext {
  credentials.set(context, connection)
  return context
}

/** Only auth calls this when preparing the configured credentials resolver. */
export function readSessionCredentials(context: IRpcFlowContext): IRpcPortableValue | undefined {
  return credentials.get(context)?.value
}
