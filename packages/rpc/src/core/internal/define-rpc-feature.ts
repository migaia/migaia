import {
  defineFeature as defineNativeFeature,
  type IFeatureFactory,
  type IFeatureRecord
} from '@migaia/plugin-host'
import type { IWebRpcFeature } from '../feature.js'
import type { IWebRpcPluginClaims } from '../typing.js'
import { registerPrivateFeaturePolicy } from './feature-policy.js'

/**
 * Package-private definition path for first-party roots. It keeps WebRPC policy separate from the
 * capability returned by the native PluginHost Feature.
 */
export const defineRpcFeature = <
  TSurface extends object,
  TDependencies extends IFeatureRecord,
  TExpose extends object
>(
  policy: Readonly<{
    readonly publicKeys: readonly string[]
    readonly conflicts?: readonly string[]
    readonly claims: IWebRpcPluginClaims
    /** Shared inputs required by this native root's own preparation boundary. */
    readonly sharedConsumes?: readonly PropertyKey[]
  }>,
  install: IFeatureFactory<TExpose, TDependencies, TSurface>,
  dependencies: TDependencies
): IWebRpcFeature<TSurface, TDependencies, TExpose> => {
  const feature = defineNativeFeature(install, dependencies)
  registerPrivateFeaturePolicy(feature, policy, policy.claims)
  return feature as IWebRpcFeature<TSurface, TDependencies, TExpose>
}
