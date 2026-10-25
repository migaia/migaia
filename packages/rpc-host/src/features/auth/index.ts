/**
 * Exposes the authentication flow factory, snapshots its cold configuration and creates a separate
 * RpcAuthenticationFlow for each native installation. Host flow setup supplies namespaces and
 * lifetime; this entry does not execute transport IO or retain replay state itself.
 */
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.js'
import type { IRpcFlowFeature } from '../../sdk/types.js'
import { snapshotAuthenticationConfig } from './config.js'
import { RpcAuthenticationFlow } from './flow.js'
import { RpcAuthenticationPluginName } from './constants.js'
import type { IRpcAuthenticationOptions } from './types.js'

export type {
  IRpcAuthenticationOptions,
  IRpcAuthenticationTransform,
  IRpcAuthenticationCredentialsContext,
  IRpcAuthenticationCredentials
} from './types.js'

/** Install actual credentials, paired transforms and physical replay windows through fixed hooks. */
export function auth(options: IRpcAuthenticationOptions): IRpcFlowFeature {
  /** One original getter snapshot is reused by every independent actual installation. */
  const captured = snapshotAuthenticationConfig(options)
  return defineBuiltinFlowFeature('auth', {
    name: RpcAuthenticationPluginName,
    setup: (context) => new RpcAuthenticationFlow(captured, context.signal, context.observe).value
  })
}

export default auth
