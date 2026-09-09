import { createComposedEndpoint } from './core.js'
import { provider } from './features/provider.js'
import type { IWebRpcKernelSurface } from './core.js'
import type { IProviderSurface } from './features/provider.js'
import type { IWebRpcFeature, IWebRpcFeatureSurface } from './feature.js'
import type { IWebRpcFactoryConfig, IWebRpcPlugin } from './typing.js'

/** Creates one provider runtime whose token includes the inseparable outbound closure. */
function createProviderEndpointRuntime<
  TTargetId extends string = string,
  TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[],
  TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
>(
  config: IWebRpcFactoryConfig<TTargetId, TMiddlewares, TFeatures> & {
    readonly features?: import('./feature.js').IWebRpcFiniteFeatureTuple<TFeatures>
  }
): Promise<IWebRpcKernelSurface & IProviderSurface & IWebRpcFeatureSurface<TFeatures>> {
  return createComposedEndpoint(
    config as unknown as IWebRpcFactoryConfig<string, readonly IWebRpcPlugin[], readonly []>,
    [provider()] as const
  ) as Promise<IWebRpcKernelSurface & IProviderSurface & IWebRpcFeatureSurface<TFeatures>>
}

import type { IChecked, ICheckedInput, IFeatures, ILegacyDefault } from './pipeline-contract.js'

/** Public provider callable prevents unchecked component configurations from reaching the runtime. */
type IPublicCallable = {
  <const TConfig extends ICheckedInput>(
    config: TConfig & IChecked<TConfig>
  ): Promise<IWebRpcKernelSurface & IProviderSurface & IWebRpcFeatureSurface<IFeatures<TConfig>>>
  <
    TTargetId extends string = string,
    TMiddlewares extends readonly IWebRpcPlugin[] = readonly IWebRpcPlugin[],
    TFeatures extends readonly IWebRpcFeature[] = readonly IWebRpcFeature[]
  >(
    config: ILegacyDefault<TTargetId, TMiddlewares, TFeatures>
  ): Promise<IWebRpcKernelSurface & IProviderSurface & IWebRpcFeatureSurface<TFeatures>>
}

/** Checked public boundary delegates to the existing provider runtime. */
export const createProviderEndpoint = createProviderEndpointRuntime as unknown as IPublicCallable
