/**
 * Publishes the complete limits flow factory and its cold configuration contracts. Each native
 * installation creates the actual lease/governor owner; Host dispatch and Session lifecycles supply
 * facts without executing this optional policy in their own owners.
 */
import { defineBuiltinFlowFeature } from '../../sdk/flow-feature.ts'
import type { IRpcFlowFeature } from '../../sdk/types.ts'
import { RpcLimitsFlow } from './flow.ts'
import { RpcLimitsPluginName } from './constants.ts'
import type { IRpcLimitsOptions } from './types.ts'

export type { IRpcLimitsOptions, IRpcLimitsOverflow, IRpcProviderRejection } from './types.ts'

/** Install one real host-local quota owner; absent installation creates no optional policy state. */
export function limitsFeature(options: IRpcLimitsOptions = {}): IRpcFlowFeature {
  /** Capture cold option values once; each receiving host constructs its own running owner. */
  const captured = { ...options }
  return defineBuiltinFlowFeature('limits', {
    name: RpcLimitsPluginName,
    setup: (context) => new RpcLimitsFlow(captured, context).value
  })
}

export default limitsFeature
