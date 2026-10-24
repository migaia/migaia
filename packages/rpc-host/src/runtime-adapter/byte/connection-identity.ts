import type { IRemoteChannel } from '../../remote/types.js'
import { defaultRpcId } from '../../core/internal/id.js'

/** Only constructed Core connections carry this internal identity; copied public data cannot. */
const identities = new WeakMap<object, Readonly<{ principalId: string }>>()

/** Core constructors retain the actual verifier result or a fresh unauthenticated connection ID. */
export function retainRuntimeConnectionIdentity<T extends IRemoteChannel>(
  connection: T,
  principalId?: string
): T {
  identities.set(connection, Object.freeze({ principalId: principalId ?? defaultRpcId() }))
  return connection
}

/** Session construction reads exact membership rather than accepting a caller's principal claim. */
export function runtimeConnectionPrincipal(connection: IRemoteChannel): string | undefined {
  return identities.get(connection)?.principalId
}
