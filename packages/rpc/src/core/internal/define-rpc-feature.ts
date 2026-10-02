import { registerJsonObjectFeature, isJsonObjectFeature } from './json-object-port.js'
import {
  defineFeature as defineNativeFeature,
  type IFeatureFactory,
  type IFeatureRecord
} from '@migaia/plugin-host'
import type { IRpcFeature } from '../feature.js'
import type { IRpcPluginClaims } from '../typing.js'
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
    readonly claims: IRpcPluginClaims
    /** Shared inputs required by this native root's own preparation boundary. */
    readonly sharedConsumes?: readonly PropertyKey[]
  }>,
  install: IFeatureFactory<TExpose, TDependencies, TSurface>,
  dependencies: TDependencies
): IRpcFeature<TSurface, TDependencies, TExpose> => {
  const feature = defineNativeFeature(install, dependencies)
  registerPrivateFeaturePolicy(feature, policy, policy.claims)
  // First-party factories construct these dependency records; unknown dependency tokens fail closed.
  return (
    Object.values(dependencies).every(isJsonObjectFeature)
      ? registerJsonObjectFeature(feature)
      : feature
  ) as IRpcFeature<TSurface, TDependencies, TExpose>
}
