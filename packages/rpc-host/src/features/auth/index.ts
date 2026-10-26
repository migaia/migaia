/**
 * Snapshot cold configuration once; create a separate flow for each native installation and its
 * lifetime.
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

/** Install credentials and paired transforms through fixed flow hooks. */
export function auth(options: IRpcAuthenticationOptions): IRpcFlowFeature {
  /** Reuse the configuration snapshot without sharing installed replay state. */
  const captured = snapshotAuthenticationConfig(options)
  return defineBuiltinFlowFeature('auth', {
    name: RpcAuthenticationPluginName,
    setup: (context) => new RpcAuthenticationFlow(captured, context.signal, context.observe).value
  })
}

export default auth
