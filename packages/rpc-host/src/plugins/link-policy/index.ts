/** Supply complete strategies through the existing native policy installation owner. */
import type { IRpcCallFeature } from '@migaia/rpc-contract/interfaces'
import { defineLinkPolicy } from '../../sdk/define.js'
import type { IRpcFlowPlugin } from '../../sdk/types.js'

/** Stable native identity lets ordinary installation reject conflicting chain defaults. */
export const RpcLinkPolicyName = 'rpc-link-policy'

/** Only complete timeout/retry instances contribute behavior; omission enables no strategy. */
export type IRpcLinkPolicyOptions = Readonly<{ features: readonly IRpcCallFeature[] }>

/** Publish defaults without another flow stage or a copy of either strategy algorithm. */
export function linkPolicy(options: IRpcLinkPolicyOptions): IRpcFlowPlugin {
  return defineLinkPolicy({ name: RpcLinkPolicyName, features: options.features })
}

export default linkPolicy
