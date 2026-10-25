/**
 * Publishes the complete limits flow factory and its cold configuration contracts. Each native
 * installation creates the actual lease/governor owner; Host dispatch and Session lifecycles supply
 * facts without executing this optional policy in their own owners.
 */
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.js'
import type { IRpcFlowFeature } from '../../sdk/types.js'
import { RpcLimitsFlow } from './flow.js'
import { RpcLimitsPluginName } from './constants.js'
import type { IRpcLimitsOptions } from './types.js'

export type { IRpcLimitsOptions, IRpcLimitsOverflow, IRpcProviderRejection } from './types.js'

/** Install one real host-local quota owner; absent installation creates no optional policy state. */
export function limits(options: IRpcLimitsOptions = {}): IRpcFlowFeature {
  /** Capture cold option values once; each receiving host constructs its own running owner. */
  const captured = { ...options }
  return defineBuiltinFlowFeature('limits', {
    name: RpcLimitsPluginName,
    setup: (context) => new RpcLimitsFlow(captured, context).value
  })
}

export default limits
