/**
 * Snapshot cold configuration once; create a separate flow for each native installation and its
 * lifetime.
 */
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.ts'
import type { IRpcFlowFeature } from '../../sdk/types.ts'
import { snapshotAuthenticationConfig } from './config.ts'
import { RpcAuthenticationFlow } from './flow.ts'
import { RpcAuthenticationPluginName } from './constants.ts'
import type { IRpcAuthenticationOptions } from './types.ts'

export type {
  IRpcAuthenticationOptions,
  IRpcAuthenticationTransform,
  IRpcAuthenticationCredentialsContext,
  IRpcAuthenticationCredentials
} from './types.ts'

/** Install credentials and paired transforms through fixed flow hooks. */
export function authFeature(options: IRpcAuthenticationOptions): IRpcFlowFeature {
  /** Reuse the configuration snapshot without sharing installed replay state. */
  const captured = snapshotAuthenticationConfig(options)
  return defineBuiltinFlowFeature('auth', {
    name: RpcAuthenticationPluginName,
    setup: (context) => new RpcAuthenticationFlow(captured, context.signal, context.observe).value
  })
}

export default authFeature
