/** Session lends secrets only to the auth resolver; ordinary pipeline contexts carry no values. */
import type { IRpcAuthenticationRetain, IRpcFlowContext } from '@migaia/rpc-contract/interfaces'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'

/** The physical Session clears its original cell when its lifetime ends. */
export type ISessionCredentials = {
  value: IRpcPortableValue | undefined
  /** Local retention borrows this same physical Session cell and never enters wire metadata. */
  retain?: IRpcAuthenticationRetain
}

/** Only the Session's original handshake output slot can identify its private credential cell. */
const credentials = new WeakMap<
  NonNullable<IRpcFlowContext['handshakeResult']>,
  ISessionCredentials
>()

/** Bind once to the original slot so forwarding an immutable context copy retains its authority. */
export function bindSessionCredentials(
  result: NonNullable<IRpcFlowContext['handshakeResult']>,
  connection: ISessionCredentials
): void {
  credentials.set(result, connection)
}

/** Only auth calls this when preparing the configured credentials resolver. */
export function readSessionCredentials(context: IRpcFlowContext): IRpcPortableValue | undefined {
  return context.handshakeResult && credentials.get(context.handshakeResult)?.value
}

/** Auth samples connection-local retention through the same genuine handshake slot as credentials. */
export function readSessionRetention(
  context: IRpcFlowContext
): IRpcAuthenticationRetain | undefined {
  return context.handshakeResult && credentials.get(context.handshakeResult)?.retain
}
